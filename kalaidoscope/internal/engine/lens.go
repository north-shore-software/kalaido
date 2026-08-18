package engine

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// maxLensCandidates bounds the distillation loop: at most this many candidate
// lenses are generated and executed before the loop gives up and keeps its
// best-scored candidate. Every returned lens has been executed — the final
// critique's revision is discarded rather than trusted unverified.
const maxLensCandidates = 4

func resolveActiveLens(app core.App, strat Strategy, rec *core.Record) (string, api.ContextSpec, types.DateTime) {
	var lastLensTime types.DateTime
	var lensPrompt string
	var lensSpec api.ContextSpec
	if lensID := rec.GetString("current_lens_id"); lensID != "" {
		if lrec, err := app.FindRecordById(strat.LensCollectionName(), lensID); err == nil {
			_ = lrec.UnmarshalJSONField("prompt", &lensPrompt)
			_ = lrec.UnmarshalJSONField("context_spec", &lensSpec)
			lastLensTime = lrec.GetDateTime("updated")
		}
	}
	return lensPrompt, lensSpec, lastLensTime
}

// retryPreempted runs one loop leg until it either finishes or fails for a
// reason other than losing its scheduler slot to higher-priority work.
func retryPreempted(f func() (string, error)) (string, error) {
	for {
		out, err := f()
		if !errors.Is(err, llmq.ErrPreempted) {
			return out, err
		}
	}
}

func refinementCollectionFor(strat Strategy) string {
	if strat.TargetType() == "reflection" {
		return "refine_refl_snapshot_conversation"
	}
	return "refine_proj_snapshot_conversation"
}

// loadRefinementHistoryBlock renders every refinement conversation held about
// this entity, oldest first, for the optimizer. Only plain text turns are
// included: intermediate draft payloads are bulky and the approved draft is
// already present as the target. Zero-message conversations contribute nothing.
func loadRefinementHistoryBlock(ctx context.Context, app core.App, strat Strategy, parentID, currentRefinementID string) string {
	recs, err := app.FindRecordsByFilter(refinementCollectionFor(strat),
		strat.ForeignKeyCol()+" = {:id}", "created", 0, 0, dbx.Params{"id": parentID})
	if err != nil {
		return ""
	}

	var blocks strings.Builder
	ordinal := 0
	for _, rec := range recs {
		msgs, err := chat.LoadMessages(ctx, app, rec)
		if err != nil {
			continue
		}
		var turns strings.Builder
		for _, m := range msgs {
			for _, p := range m.Parts {
				if p.Type == "text" && strings.TrimSpace(p.Text) != "" {
					turns.WriteString(prompts.HistoryTurnLine(m.Role, p.Text))
				}
			}
		}
		if turns.Len() == 0 {
			continue
		}
		ordinal++
		label := prompts.HistoryHistoricalLabel
		if rec.Id == currentRefinementID {
			label = prompts.HistoryCurrentLabel
		}
		blocks.WriteString(prompts.RefinementHistoryBlock(ordinal, label, turns.String()))
	}
	if blocks.Len() == 0 {
		return ""
	}
	return prompts.RefinementHistoryHeading + blocks.String() + "\n"
}

// distillLensLoop turns the one-shot distillation into an optimization loop:
// generate a candidate lens, execute it exactly as production will, and feed
// the result back for critique and rewriting until the lens reproduces the
// target or the candidate budget runs out. The optimizer holds one growing
// conversation — every failed attempt stays visible so it isn't repeated —
// while each execution is a stateless production apply call that sees only the
// lens and the sources. Previous lenses are never an input: the target itself
// carries everything earlier refinements established.
func distillLensLoop(ctx context.Context, app core.App, strat Strategy, snap *core.Record) (lens string, iterations int, converged bool, err error) {
	var resCtx llmcontext.PinnedIDs
	_ = snap.UnmarshalJSONField("resolved_context", &resCtx)
	// The same hydration production apply uses (see prepareGenerationContext):
	// the execute leg only verifies the lens if it sees identical sources.
	sourceBlock, _ := llmcontext.HydrateIDsToText(ctx, app, resCtx)
	target := pbutil.DecodeJSONString(snap.GetString("output"))
	historyBlock := loadRefinementHistoryBlock(ctx, app, strat, snap.GetString(strat.ForeignKeyCol()), snap.GetString("created_from_refinement_id"))

	transcript := []llm.Message{
		{Role: "system", Content: prompts.DistillLoopSystem},
		{Role: "user", Content: prompts.DistillLoopInitial(sourceBlock, historyBlock, target)},
	}
	optimize := func() (string, error) {
		return retryPreempted(func() (string, error) {
			return usage.GenerateOnceMsgs(ctx, app, transcript, llm.RoleDistill, nil)
		})
	}

	reply, err := optimize()
	if err != nil {
		return "", 0, false, err
	}
	lens = strings.TrimSpace(reply)
	if lens == "" {
		return "", 0, false, fmt.Errorf("distill %s %s: model returned an empty lens", strat.TargetType(), snap.Id)
	}
	transcript = append(transcript, llm.Message{Role: "assistant", Content: reply})

	bestLens, bestScore := lens, -1
	for i := 0; i < maxLensCandidates; i++ {
		iterations = i + 1

		candidate, err := retryPreempted(func() (string, error) {
			return GenerateOutput(ctx, app, lens, sourceBlock)
		})
		if err != nil {
			return "", iterations, false, err
		}
		if candidate == target {
			return lens, iterations, true, nil
		}

		transcript = append(transcript, llm.Message{Role: "user", Content: prompts.DistillLoopFeedback(candidate)})
		reply, err = optimize()
		if err != nil {
			return "", iterations, false, err
		}
		transcript = append(transcript, llm.Message{Role: "assistant", Content: reply})

		verdict, ok := prompts.ParseLoopReply(reply)
		if !ok {
			log.Printf("lens distillation: %s %s: unparseable critique on iteration %d; keeping best candidate", strat.TargetType(), snap.Id, iterations)
			break
		}
		if verdict.Match {
			return lens, iterations, true, nil
		}
		if verdict.Score > bestScore {
			bestLens, bestScore = lens, verdict.Score
		}
		next := strings.TrimSpace(verdict.Lens)
		if next == "" || i == maxLensCandidates-1 {
			break
		}
		lens = next
	}
	return bestLens, iterations, false, nil
}

// DistillAndUpdateLens runs the distillation loop for one refinement-committed
// snapshot and installs the result. Everything it needs is derived from the
// snapshot record, so the background worker can resume it from DB state alone.
func DistillAndUpdateLens(ctx context.Context, app core.App, strat Strategy, snap *core.Record) error {
	parentID := snap.GetString(strat.ForeignKeyCol())
	rec, err := app.FindRecordById(strat.CollectionName(), parentID)
	if err != nil {
		return err
	}

	newLensPrompt, iterations, converged, err := distillLensLoop(ctx, app, strat, snap)
	if err != nil {
		return err
	}

	var spec api.ContextSpec
	_ = snap.UnmarshalJSONField("context_spec", &spec)

	col, _ := app.FindCollectionByNameOrId(strat.LensCollectionName())
	lensRec := core.NewRecord(col)
	// Audit lineage only: the loop never reads the previous lens.
	if oldLensID := rec.GetString("current_lens_id"); oldLensID != "" {
		lensRec.Set("parent_lens_id", oldLensID)
	}
	lensRec.Set("prompt", pbutil.JSONString(newLensPrompt))
	lensRec.Set("context_spec", pbutil.JSONObject(spec))
	lensRec.Set("iterations", iterations)
	lensRec.Set("converged", converged)
	if model, err := llm.ResolveRole(llm.RoleDistill); err == nil {
		lensRec.Set("model", model)
	}
	if refinementID := snap.GetString("created_from_refinement_id"); refinementID != "" {
		if strat.TargetType() == "reflection" {
			lensRec.Set("created_from_refl_refinement_id", refinementID)
		} else {
			lensRec.Set("created_from_proj_refinement_id", refinementID)
		}
	}
	if err := app.Save(lensRec); err != nil {
		return err
	}

	rec.Set("current_lens_id", lensRec.Id)
	if err := app.Save(rec); err != nil {
		return err
	}

	snap.Set("lens_id", lensRec.Id)
	return app.Save(snap)
}
