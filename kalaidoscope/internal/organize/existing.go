package organize

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

// listExisting renders everything already spoken for: every persisted
// projection/reflection in the workspace (human-created or from any organize
// run), plus this run's in-flight claims — forks still exploring a story, and
// entities this run created whose rows may not be visible yet to a sibling.
// Dedup is the model's job, judged by story; this just makes sure it can see
// what's there. No LLM calls, no budget.
func listExisting(app core.App, run *core.Record, registry *runRegistry) string {
	var lines []string
	seen := make(map[string]bool)

	for _, col := range []string{"projection", "reflection"} {
		recs, err := app.FindRecordsByFilter(col, "1=1", "created", 0, 0, nil)
		if err != nil {
			lines = append(lines, fmt.Sprintf("(could not list %ss: %v)", col, err))
			continue
		}
		for _, r := range recs {
			seen[r.Id] = true
			lines = append(lines, describeEntity(app, col, r, run.Id))
		}
	}

	for _, c := range registry.snapshot() {
		switch c.status {
		case "exploring":
			lines = append(lines, prompts.OrganizeExistingInProgress(c.brief, formatNodeRefs(c.nodes)))
		case "created":
			// Persisted rows from this run already appear above; only the
			// window between Save and a sibling's query could miss one, and
			// the description is cheap, so list it regardless under its own
			// origin label and let the model see it twice at worst.
			lines = append(lines, prompts.OrganizeExistingEntity(c.kind, c.name, c.brief, formatNodeRefs(c.nodes), "", "this run"))
		}
	}

	if len(lines) == 0 {
		return prompts.OrganizeExistingNone
	}
	return prompts.OrganizeExistingHeader + strings.Join(lines, "\n")
}

func describeEntity(app core.App, kind string, r *core.Record, runID string) string {
	origin := "human-created"
	switch r.GetString("origin_run_id") {
	case "":
	case runID:
		origin = "this run"
	default:
		origin = "an earlier organize run"
	}

	var spec api.ContextSpec
	_ = r.UnmarshalJSONField("current_context_spec", &spec)
	scope := "whole workspace"
	if !spec.WholeScope {
		scope = colourNames(app, spec.ColourIDs)
		if scope == "" {
			scope = "(no colours)"
		}
	}

	window := ""
	if kind == "reflection" {
		var versions []api.WindowSpecVersion
		_ = r.UnmarshalJSONField("window_spec_versions", &versions)
		if n := len(versions); n > 0 {
			w := versions[n-1].Spec
			window = strings.TrimSpace(fmt.Sprintf("%s %s from %s", w.Mode, w.Period, w.StartTime))
		}
	}

	return prompts.OrganizeExistingEntity(kind, r.GetString("name"), r.GetString("brief"), scope, window, origin)
}

func colourNames(app core.App, ids []string) string {
	var names []string
	for _, id := range ids {
		rec, err := app.FindRecordById("colour", id)
		if err != nil {
			continue
		}
		names = append(names, rec.GetString("name"))
	}
	return strings.Join(names, ", ")
}
