package projections

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const briefTrackerStoreKey = "kalaido.projections.brief_tracker"

var briefTrackerInitMu sync.Mutex

type briefInFlight struct {
	done chan struct{}
}

// BriefTracker coordinates in-flight async editorial brief distillation jobs
// per projection so GET .../lens can report `updating: true` and Update/Fork
// can optionally await completion.
type BriefTracker struct {
	mu       sync.Mutex
	inFlight map[string]*briefInFlight
}

func briefTrackerFor(app core.App) *BriefTracker {
	if app == nil {
		return &BriefTracker{inFlight: make(map[string]*briefInFlight)}
	}
	if v := app.Store().Get(briefTrackerStoreKey); v != nil {
		if t, ok := v.(*BriefTracker); ok {
			return t
		}
	}
	briefTrackerInitMu.Lock()
	defer briefTrackerInitMu.Unlock()
	if v := app.Store().Get(briefTrackerStoreKey); v != nil {
		if t, ok := v.(*BriefTracker); ok {
			return t
		}
	}
	t := &BriefTracker{inFlight: make(map[string]*briefInFlight)}
	app.Store().Set(briefTrackerStoreKey, t)
	return t
}

func (t *BriefTracker) begin(projectionID string) *briefInFlight {
	entry := &briefInFlight{done: make(chan struct{})}
	t.mu.Lock()
	t.inFlight[projectionID] = entry
	t.mu.Unlock()
	return entry
}

func (t *BriefTracker) end(projectionID string, entry *briefInFlight) {
	t.mu.Lock()
	if t.inFlight[projectionID] == entry {
		delete(t.inFlight, projectionID)
	}
	t.mu.Unlock()
	close(entry.done)
}

// IsBriefUpdating reports whether an async Save-time editorial brief
// distillation is currently running for projectionID.
func IsBriefUpdating(app core.App, projectionID string) bool {
	t := briefTrackerFor(app)
	t.mu.Lock()
	_, ok := t.inFlight[projectionID]
	t.mu.Unlock()
	return ok
}

// AwaitBriefDistillation waits for any in-flight brief distillation for
// projectionID to finish, or returns early if ctx expires.
func AwaitBriefDistillation(ctx context.Context, app core.App, projectionID string) {
	t := briefTrackerFor(app)
	t.mu.Lock()
	entry := t.inFlight[projectionID]
	t.mu.Unlock()
	if entry == nil {
		return
	}
	select {
	case <-entry.done:
	case <-ctx.Done():
	}
}

// ReadLens returns the projection's current lens id, prompt text, and whether
// an async distillation job is currently running for it.
func ReadLens(app core.App, projectionID string) (api.ProjectionLensResponse, error) {
	proj, err := FindLive(app, projectionID)
	if err != nil {
		return api.ProjectionLensResponse{}, fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	lensID, prompt := engine.ReadActiveLens(app, Strategy{}, proj)
	return api.ProjectionLensResponse{
		LensID:   lensID,
		Prompt:   prompt,
		Updating: IsBriefUpdating(app, projectionID),
	}, nil
}

// UpdateLens appends a new lens row for projectionID and points
// current_lens_id at it.
func UpdateLens(app core.App, projectionID, prompt string) (api.ProjectionLensResponse, error) {
	if _, err := FindLive(app, projectionID); err != nil {
		return api.ProjectionLensResponse{}, fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	trimmed := strings.TrimSpace(prompt)
	lensID, err := engine.UpdateActiveLens(app, Strategy{}, projectionID, trimmed)
	if err != nil {
		return api.ProjectionLensResponse{}, err
	}
	return api.ProjectionLensResponse{
		LensID:   lensID,
		Prompt:   trimmed,
		Updating: IsBriefUpdating(app, projectionID),
	}, nil
}

// DistillBriefParams carries the immutable snapshot of inputs captured at Save
// time for asynchronous living editorial brief distillation.
type DistillBriefParams struct {
	ProjectionID        string
	PreviousLensID      string
	PreviousLensPrompt  string
	FinalSnapshotOutput string
	RefinementID        string
	Edits               []api.SnapshotEdit
	Transcript          []api.UIMessage
	GenerateWithModel   string
}

// StartBriefDistillation spawns a tracked background job on runner to distill
// the projection's living editorial brief. No-op if runner is nil.
func StartBriefDistillation(runner workerutil.Runner, app core.App, params DistillBriefParams) {
	if runner == nil || strings.TrimSpace(params.FinalSnapshotOutput) == "" {
		return
	}
	tracker := briefTrackerFor(app)
	entry := tracker.begin(params.ProjectionID)
	runner.Go(func(ctx context.Context) {
		defer tracker.end(params.ProjectionID, entry)
		if err := DistillLivingBrief(ctx, app, params); err != nil {
			logger().Warn("async editorial brief distillation failed",
				"projection_id", params.ProjectionID, "error", err)
		}
	})
}

// DistillLivingBrief runs one LLM call to compile/update the projection's
// data-agnostic living editorial brief and persists it under an optimistic
// concurrency guard (current_lens_id == PreviousLensID) so concurrent manual
// PUT .../lens edits are never clobbered.
func DistillLivingBrief(ctx context.Context, app core.App, params DistillBriefParams) error {
	model, err := llm.ResolveRoleFor(llm.RoleRefinement, params.GenerateWithModel)
	if err != nil {
		return fmt.Errorf("resolve brief model: %w", err)
	}

	transcriptSummary := summarizeTranscriptForBrief(params.Transcript)
	editsSummary := summarizeEditsForBrief(params.Edits)
	userPrompt := prompts.DistillLivingBriefUserPrompt(
		params.PreviousLensPrompt,
		params.FinalSnapshotOutput,
		transcriptSummary,
		editsSummary,
	)

	msgs := []llm.Message{
		{Role: "system", Content: prompts.DistillLivingBriefSystemPrompt},
		{Role: "user", Content: userPrompt},
	}
	if err := llm.CheckPromptFits(model, llm.MessagesChars(msgs)); err != nil {
		// Retry without transcript if transcript pushed us over the window.
		msgs[1].Content = prompts.DistillLivingBriefUserPrompt(
			params.PreviousLensPrompt,
			params.FinalSnapshotOutput,
			"",
			editsSummary,
		)
		if err2 := llm.CheckPromptFits(model, llm.MessagesChars(msgs)); err2 != nil {
			return fmt.Errorf("brief prompt too large: %w", err2)
		}
	}

	distilled, err := usage.GenerateOnceMsgs(ctx, app, msgs, llm.RoleRefinement, model, nil)
	if err != nil {
		return fmt.Errorf("generate brief: %w", err)
	}
	distilled = strings.TrimSpace(distilled)
	if distilled == "" {
		return fmt.Errorf("brief model returned empty output")
	}

	return app.RunInTransaction(func(tx core.App) error {
		proj, err := FindLive(tx, params.ProjectionID)
		if err != nil {
			return err
		}
		// Optimistic concurrency guard: if the user edited the brief manually
		// (or a newer Save already updated current_lens_id) while distillation
		// was running, do not overwrite the newer brief.
		if proj.GetString("current_lens_id") != params.PreviousLensID {
			logger().Info("skipping async brief write; current_lens_id changed concurrently",
				"projection_id", params.ProjectionID,
				"expected_lens_id", params.PreviousLensID,
				"actual_lens_id", proj.GetString("current_lens_id"))
			return nil
		}

		lensCol, err := tx.FindCollectionByNameOrId(schema.ColLens.String())
		if err != nil {
			return err
		}
		lensRec := core.NewRecord(lensCol)
		if params.PreviousLensID != "" {
			lensRec.Set("parent_lens_id", params.PreviousLensID)
		}
		lensRec.Set("prompt", distilled)
		if params.RefinementID != "" {
			lensRec.Set("created_from_projection_refinement_id", params.RefinementID)
		}
		if err := tx.Save(lensRec); err != nil {
			return err
		}

		proj.Set("current_lens_id", lensRec.Id)
		return tx.Save(proj)
	})
}

func summarizeTranscriptForBrief(msgs []api.UIMessage) string {
	var lines []string
	for _, m := range msgs {
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		var texts []string
		for _, p := range m.Parts {
			if p.Type == "text" && strings.TrimSpace(p.Text) != "" {
				texts = append(texts, strings.TrimSpace(p.Text))
			}
		}
		if len(texts) == 0 {
			continue
		}
		roleLabel := "User"
		if m.Role == "assistant" {
			roleLabel = "Assistant"
		}
		lines = append(lines, roleLabel+": "+strings.Join(texts, "\n"))
	}
	return strings.Join(lines, "\n\n")
}

func summarizeEditsForBrief(edits []api.SnapshotEdit) string {
	var lines []string
	for _, e := range edits {
		if e.Status != api.EditStatusApproved {
			continue
		}
		if e.Type != api.EditTypeManual && e.Type != api.EditTypeRefinement {
			continue
		}
		lines = append(lines, fmt.Sprintf("- [%s edit #%d] Before: %q -> After: %q", e.Type, e.Sequence, truncateForBrief(e.ContentBefore, 240), truncateForBrief(e.ContentAfter, 240)))
	}
	return strings.Join(lines, "\n")
}

func truncateForBrief(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}
