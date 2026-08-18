package engine

import (
	"context"
	"encoding/json"
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
// best-scored candidate. Every returned lens has been executed — a lens is
// never shipped unverified.
const maxLensCandidates = 4

// leakRunWords is the tripwire threshold: a candidate lens sharing this many
// consecutive words with the target has copied it — which the generator can
// only do if target content leaked through the critic's diagnosis.
const leakRunWords = 8

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

// loadIntentTimeline renders the generator's seed: every refinement
// conversation held about this entity, oldest first, with source-context
// changes shown inline at the point where they happened — a chat remark only
// makes sense against the sources as they stood when it was said. One running
// context state threads across conversations, so the first recorded state
// renders the initial sources in full and every later state renders as a
// delta; after the last conversation the state is diffed against the
// snapshot's resolved context so the timeline ends at the sources the lens
// will actually be applied to.
//
// Only plain text turns are included. Draft and tool parts are deliberately
// excluded: intermediate drafts approximate the approved target, and the
// generator must never see the target.
func loadIntentTimeline(ctx context.Context, app core.App, strat Strategy, parentID, currentRefinementID string, finalPinned llmcontext.PinnedIDs, sourceBlock string) string {
	recs, err := app.FindRecordsByFilter(refinementCollectionFor(strat),
		strat.ForeignKeyCol()+" = {:id}", "created", 0, 0, dbx.Params{"id": parentID})
	if err != nil {
		recs = nil
	}

	var blocks strings.Builder
	var active llmcontext.PinnedIDs
	sawPinned := false
	ordinal := 0
	for _, rec := range recs {
		msgs, err := chat.LoadMessages(ctx, app, rec)
		if err != nil {
			continue
		}
		var turns strings.Builder
		for _, m := range msgs {
			if m.Role == "system" {
				var pinned llmcontext.PinnedIDs
				found := false
				for _, p := range m.Parts {
					if p.Type == "pinned_ids" && len(p.Data) > 0 && json.Unmarshal(p.Data, &pinned) == nil {
						found = true
					}
				}
				if !found {
					continue
				}
				added, removed := llmcontext.DiffPinnedIDs(active, pinned)
				if deltaText, err := llmcontext.HydrateDeltaToText(ctx, app, added, removed); err == nil && strings.TrimSpace(deltaText) != "" {
					turns.WriteString(prompts.ContextChangeBlock(deltaText))
				}
				active = pinned
				sawPinned = true
				continue
			}
			for _, p := range m.Parts {
				if p.Type == "text" && strings.TrimSpace(p.Text) != "" {
					// The same mention expansion Flatten applies: the timeline must
					// reproduce what the refinement model saw, and the expanded ID is
					// the join key to the hydrated blocks above.
					turns.WriteString(prompts.HistoryTurnLine(m.Role, llmcontext.ExpandMentions(p.Text)))
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

	if !sawPinned {
		// No conversation recorded its context state: fall back to opening the
		// timeline with the sources as they stand now.
		return prompts.TimelineSourcesHeading + sourceBlock + "\n" + blocks.String()
	}

	// The sources may have changed again since the last recorded state — end
	// the timeline at the exact set the lens will be applied to.
	added, removed := llmcontext.DiffPinnedIDs(active, finalPinned)
	if deltaText, err := llmcontext.HydrateDeltaToText(ctx, app, added, removed); err == nil && strings.TrimSpace(deltaText) != "" {
		blocks.WriteString(prompts.ContextChangeBlock(deltaText))
	}
	return blocks.String()
}

// normalizeWords lowercases and strips non-alphanumeric runes so markdown
// decoration can't hide a verbatim copy.
func normalizeWords(s string) []string {
	var words []string
	for _, f := range strings.Fields(strings.ToLower(s)) {
		var b strings.Builder
		for _, r := range f {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
				b.WriteRune(r)
			}
		}
		if b.Len() > 0 {
			words = append(words, b.String())
		}
	}
	return words
}

// sharesVerbatimRun reports whether a and b share a run of leakRunWords
// consecutive normalized words — long enough that legitimate short echoes
// (a heading, a term of art) never trip it, only copying does.
func sharesVerbatimRun(a, b string) bool {
	aw, bw := normalizeWords(a), normalizeWords(b)
	if len(aw) < leakRunWords || len(bw) < leakRunWords {
		return false
	}
	windows := make(map[string]bool, len(bw))
	for i := 0; i+leakRunWords <= len(bw); i++ {
		windows[strings.Join(bw[i:i+leakRunWords], " ")] = true
	}
	for i := 0; i+leakRunWords <= len(aw); i++ {
		if windows[strings.Join(aw[i:i+leakRunWords], " ")] {
			return true
		}
	}
	return false
}

// distillLensLoop turns distillation into an optimization loop with the target
// isolated from the lens writer, so memorizing the target is impossible rather
// than merely forbidden. Three threads:
//
//   - generator: one growing conversation seeded with the intent timeline. It
//     never sees the target — only the critic's diagnoses.
//   - execute: a stateless production apply call per candidate, seeing only
//     the lens and the sources.
//   - critic: one growing conversation and the only holder of the target; it
//     grades each executed candidate and its diagnosis is relayed back.
//
// Previous lenses are never an input: the refinement conversations and the
// critic's judgment carry everything earlier refinements established.
func distillLensLoop(ctx context.Context, app core.App, strat Strategy, snap *core.Record) (lens string, iterations int, converged bool, err error) {
	var resCtx llmcontext.PinnedIDs
	_ = snap.UnmarshalJSONField("resolved_context", &resCtx)
	// The same hydration production apply uses (see prepareGenerationContext):
	// the execute leg only verifies the lens if it sees identical sources.
	sourceBlock, _ := llmcontext.HydrateIDsToText(ctx, app, resCtx)
	target := pbutil.DecodeJSONString(snap.GetString("output"))
	timeline := loadIntentTimeline(ctx, app, strat, snap.GetString(strat.ForeignKeyCol()), snap.GetString("created_from_refinement_id"), resCtx, sourceBlock)

	genChat := []llm.Message{
		{Role: "system", Content: prompts.DistillGenSystem},
		{Role: "user", Content: prompts.DistillGenInitial(timeline)},
	}
	criticChat := []llm.Message{
		{Role: "system", Content: prompts.DistillCriticSystem},
	}
	generate := func() (string, error) {
		return retryPreempted(func() (string, error) {
			return usage.GenerateOnceMsgs(ctx, app, genChat, llm.RoleDistill, nil)
		})
	}
	critique := func() (string, error) {
		return retryPreempted(func() (string, error) {
			return usage.GenerateOnceMsgs(ctx, app, criticChat, llm.RoleDistill, nil)
		})
	}

	bestLens, bestScore := "", -1
	lastExecuted := ""
	for i := 0; i < maxLensCandidates; i++ {
		iterations = i + 1

		reply, err := generate()
		if err != nil {
			return "", iterations, false, err
		}
		lens = strings.TrimSpace(reply)
		if lens == "" {
			return "", iterations, false, fmt.Errorf("distill %s %s: model returned an empty lens", strat.TargetType(), snap.Id)
		}
		genChat = append(genChat, llm.Message{Role: "assistant", Content: reply})

		if sharesVerbatimRun(lens, target) {
			// The generator can only copy the target if the critic leaked it.
			log.Printf("lens distillation: %s %s: candidate %d quotes the target verbatim (critic leak); keeping best prior candidate", strat.TargetType(), snap.Id, iterations)
			break
		}

		candidate, err := retryPreempted(func() (string, error) {
			return GenerateOutput(ctx, app, lens, sourceBlock)
		})
		if err != nil {
			return "", iterations, false, err
		}
		lastExecuted = lens
		if candidate == target {
			return lens, iterations, true, nil
		}

		if len(criticChat) == 1 {
			criticChat = append(criticChat, llm.Message{Role: "user", Content: prompts.DistillCriticInitial(target, candidate)})
		} else {
			criticChat = append(criticChat, llm.Message{Role: "user", Content: prompts.DistillCriticCandidate(candidate)})
		}
		creply, err := critique()
		if err != nil {
			return "", iterations, false, err
		}
		criticChat = append(criticChat, llm.Message{Role: "assistant", Content: creply})

		verdict, ok := prompts.ParseCriticReply(creply)
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
		if i < maxLensCandidates-1 {
			genChat = append(genChat, llm.Message{Role: "user", Content: prompts.DistillGenFeedback(verdict.Diagnosis)})
		}
	}
	if bestScore >= 0 {
		return bestLens, iterations, false, nil
	}
	if lastExecuted != "" {
		// Executed but never scored (the critique broke down): still verified
		// to run, and better than nothing.
		return lastExecuted, iterations, false, nil
	}
	return "", iterations, false, fmt.Errorf("distill %s %s: no candidate lens survived", strat.TargetType(), snap.Id)
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
