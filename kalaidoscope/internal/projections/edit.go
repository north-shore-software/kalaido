package projections

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const StoreKeyHandEditCreateFragment = "kalaido.projections.hand_edit_create_fragment"

// SetHandEditCreateFragment overrides whether hand edits create a fragment on this app instance.
func SetHandEditCreateFragment(app core.App, enable bool) {
	if app != nil {
		app.Store().Set(StoreKeyHandEditCreateFragment, enable)
	}
}

func shouldCreateFragment(app core.App) bool {
	if app != nil {
		if v := app.Store().Get(StoreKeyHandEditCreateFragment); v != nil {
			if b, ok := v.(bool); ok {
				return b
			}
		}
	}
	return config.HandEditCreateFragment()
}

var (
	ErrEditNotPending       = errors.New("candidate is not pending review")
	ErrInvalidBlockPosition = errors.New("invalid block position")
	ErrEditUnderMarker      = errors.New("cannot edit a block under an unresolved edit marker")
	ErrEditNoChange         = errors.New("edit changes nothing")
	ErrEditNotFound         = errors.New("snapshot edit not found")
	ErrInvalidEditStatus    = errors.New("invalid snapshot edit status")
	ErrEditAlreadyResolved  = errors.New("snapshot edit is already resolved")
	ErrEditNotUndoable      = errors.New("snapshot edit is not undoable")
	ErrTargetNotFound       = errors.New("refinement target passage not found in draft")
)

var ErrEditRejected = errors.New("edit rejected")

type EditResult struct {
	FragmentID string
	Edit       api.SnapshotEdit
}

func logger() *slog.Logger {
	return slog.Default().With("component", "projections")
}

func loadPendingCandidate(tx core.App, parentID, sourceSnapshotID, op string) (*core.Record, *core.Record, error) {
	strat := Strategy{}
	parent, err := FindLive(tx, parentID)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: projection %s: %w", op, parentID, err)
	}
	src, err := tx.FindRecordById(strat.SnapshotCollectionName(), sourceSnapshotID)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: candidate %s: %w", op, sourceSnapshotID, err)
	}
	if src.GetString(strat.ForeignKeyCol()) != parentID {
		return nil, nil, fmt.Errorf("%s: candidate %s does not belong to projection %s", op, sourceSnapshotID, parentID)
	}
	if src.GetString("status") != engine.StatusPending {
		return nil, nil, fmt.Errorf("%w: %w", ErrEditRejected, ErrEditNotPending)
	}
	return parent, src, nil
}

func joinMarkdownBlocks(blocks []string) string {
	var cleaned []string
	for _, b := range blocks {
		if strings.TrimSpace(b) != "" {
			cleaned = append(cleaned, b)
		}
	}
	return strings.Join(cleaned, "\n\n")
}

func ApplyEdit(ctx context.Context, app core.App, parentID, sourceSnapshotID string, blockPosition int, newText string) (EditResult, error) {
	var res EditResult
	err := app.RunInTransaction(func(tx core.App) error {
		parent, src, err := loadPendingCandidate(tx, parentID, sourceSnapshotID, "edit")
		if err != nil {
			return err
		}

		draft := src.GetString("output_draft")
		if draft == "" {
			draft = src.GetString("output")
		}

		blocks := engine.SegmentMarkdownBlocks(draft)
		if blockPosition < 0 || blockPosition >= len(blocks) {
			return fmt.Errorf("%w: %w: %d", ErrEditRejected, ErrInvalidBlockPosition, blockPosition)
		}

		oldText := blocks[blockPosition]
		if strings.Contains(oldText, engine.EditMarkerPrefix) {
			return fmt.Errorf("%w: %w", ErrEditRejected, ErrEditUnderMarker)
		}

		if oldText == newText {
			return fmt.Errorf("%w: %w", ErrEditRejected, ErrEditNoChange)
		}

		blocks[blockPosition] = newText
		newDraft := joinMarkdownBlocks(blocks)

		var fragID string
		if shouldCreateFragment(tx) {
			fragCol, err := tx.FindCollectionByNameOrId(schema.ColFragment.String())
			if err != nil {
				return err
			}
			frag := core.NewRecord(fragCol)
			frag.Set("type", prompts.EditFragmentKind)
			frag.Set("ingested_via", "app")
			frag.Set("source", fmt.Sprintf("edit to projection %q (candidate %s)", parent.GetString("name"), src.Id))
			frag.Set("content", prompts.EditFragmentContent(oldText, newText))
			frag.Set("occurred_at", types.NowDateTime())
			if err := tx.Save(frag); err != nil {
				return fmt.Errorf("edit: save fragment: %w", err)
			}
			fragID = frag.Id

			var parentSpec api.ContextSpec
			if err := parent.UnmarshalJSONField("current_context_spec", &parentSpec); err != nil {
				return fmt.Errorf("edit: parent context spec: %w", err)
			}
			parentSpec.FragmentIDs = appendUnique(parentSpec.FragmentIDs, fragID)
			parent.Set("current_context_spec", pbutil.JSONObject(parentSpec))
			if err := tx.Save(parent); err != nil {
				return fmt.Errorf("edit: pin fragment on projection: %w", err)
			}
		}

		var snapSpec api.ContextSpec
		if err := src.UnmarshalJSONField("context_spec", &snapSpec); err != nil {
			return fmt.Errorf("edit: candidate context spec: %w", err)
		}
		if fragID != "" {
			snapSpec.FragmentIDs = appendUnique(snapSpec.FragmentIDs, fragID)
		}

		var pinned llmcontext.PinnedIDs
		if err := src.UnmarshalJSONField("resolved_context", &pinned); err != nil {
			return fmt.Errorf("edit: candidate resolved context: %w", err)
		}
		if fragID != "" {
			pinned.FragmentIDs = appendUnique(pinned.FragmentIDs, fragID)
			pinned.ExpandedIDs = appendUnique(pinned.ExpandedIDs, fragID)
		}

		edits := engine.LoadSnapshotEdits(src)
		now := time.Now().UTC().Format(time.RFC3339)
		edit := api.SnapshotEdit{
			ID:            security.RandomString(15),
			Sequence:      len(edits) + 1,
			Type:          api.EditTypeManual,
			Status:        api.EditStatusApproved,
			ContentBefore: oldText,
			ContentAfter:  newText,
			BlockIndex:    blockPosition,
			FragmentID:    fragID,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		edits = append(edits, edit)

		src.Set("output", "")
		src.Set("output_draft", newDraft)
		src.Set("context_spec", pbutil.JSONObject(snapSpec))
		src.Set("resolved_context", pbutil.JSONObject(pinned))
		edits = recomputeUndoable(newDraft, edits)
		src.Set("edits", pbutil.JSONObject(edits))
		if err := tx.Save(src); err != nil {
			return fmt.Errorf("edit: update candidate: %w", err)
		}

		_ = RecordHandEditNotice(ctx, tx, parentID, sourceSnapshotID, edit)

		res = EditResult{FragmentID: fragID, Edit: edit}
		return nil
	})
	if err != nil {
		return EditResult{}, err
	}
	logger().Info("candidate edited by hand",
		"target_type", "projection", "id", parentID, "source_snapshot_id", sourceSnapshotID,
		"edit_id", res.Edit.ID, "fragment_id", res.FragmentID)
	return res, nil
}

func normalizeWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func ProposeRefineEdit(ctx context.Context, app core.App, parentID, sourceSnapshotID string, target, replacement string) (EditResult, error) {
	target = strings.TrimSpace(target)
	replacement = strings.TrimSpace(replacement)
	if target == replacement {
		return EditResult{}, fmt.Errorf("%w: %w", ErrEditRejected, ErrEditNoChange)
	}

	var res EditResult
	err := app.RunInTransaction(func(tx core.App) error {
		_, src, err := loadPendingCandidate(tx, parentID, sourceSnapshotID, "propose edit")
		if err != nil {
			return err
		}

		draft := src.GetString("output_draft")
		if draft == "" {
			draft = src.GetString("output")
		}

		blocks := engine.SegmentMarkdownBlocks(draft)
		normTarget := normalizeWhitespace(target)
		startIdx, endIdx := -1, -1
		for i := 0; i < len(blocks); i++ {
			for j := i; j < len(blocks); j++ {
				cand := strings.Join(blocks[i:j+1], "\n\n")
				if normalizeWhitespace(cand) == normTarget {
					startIdx, endIdx = i, j
					break
				}
			}
			if startIdx != -1 {
				break
			}
		}

		var (
			contentBefore string
			newDraft      string
			blockIndex    int
		)

		edits := engine.LoadSnapshotEdits(src)
		now := time.Now().UTC().Format(time.RFC3339)
		editID := security.RandomString(15)
		marker := engine.FormatEditMarker(editID)

		if startIdx != -1 {
			for k := startIdx; k <= endIdx; k++ {
				if strings.Contains(blocks[k], engine.EditMarkerPrefix) {
					return fmt.Errorf("%w: %w", ErrEditRejected, ErrEditUnderMarker)
				}
			}
			contentBefore = strings.Join(blocks[startIdx:endIdx+1], "\n\n")
			blockIndex = startIdx
			newBlocks := make([]string, 0, len(blocks)-(endIdx-startIdx))
			newBlocks = append(newBlocks, blocks[:startIdx]...)
			newBlocks = append(newBlocks, marker)
			newBlocks = append(newBlocks, blocks[endIdx+1:]...)
			newDraft = joinMarkdownBlocks(newBlocks)
		} else {
			tokens := strings.Fields(target)
			if len(tokens) == 0 {
				return fmt.Errorf("%w: %q", ErrTargetNotFound, target)
			}
			var sb strings.Builder
			for idx, tok := range tokens {
				if idx > 0 {
					sb.WriteString(`\s+`)
				}
				sb.WriteString(regexp.QuoteMeta(tok))
			}
			re, err := regexp.Compile(sb.String())
			if err != nil {
				return fmt.Errorf("%w: %q", ErrTargetNotFound, target)
			}
			matchedBlockIdx := -1
			var loc []int
			for i, b := range blocks {
				loc = re.FindStringIndex(b)
				if loc != nil {
					matchedBlockIdx = i
					break
				}
			}
			if matchedBlockIdx == -1 {
				return fmt.Errorf("%w: %q", ErrTargetNotFound, target)
			}
			if strings.Contains(blocks[matchedBlockIdx], engine.EditMarkerPrefix) {
				return fmt.Errorf("%w: %w", ErrEditRejected, ErrEditUnderMarker)
			}
			b := blocks[matchedBlockIdx]
			contentBefore = b[loc[0]:loc[1]]
			blockIndex = matchedBlockIdx
			newBlock := b[:loc[0]] + marker + b[loc[1]:]
			newBlocks := make([]string, len(blocks))
			copy(newBlocks, blocks)
			newBlocks[matchedBlockIdx] = newBlock
			newDraft = joinMarkdownBlocks(newBlocks)
		}

		edit := api.SnapshotEdit{
			ID:            editID,
			Sequence:      len(edits) + 1,
			Type:          api.EditTypeRefinement,
			Status:        api.EditStatusProposed,
			ContentBefore: contentBefore,
			ContentAfter:  replacement,
			BlockIndex:    blockIndex,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		edits = append(edits, edit)

		src.Set("output_draft", newDraft)
		edits = recomputeUndoable(newDraft, edits)
		src.Set("edits", pbutil.JSONObject(edits))
		if err := tx.Save(src); err != nil {
			return fmt.Errorf("propose edit: update candidate: %w", err)
		}

		res = EditResult{Edit: edit}
		return nil
	})
	if err != nil {
		return EditResult{}, err
	}
	logger().Info("candidate edit proposed by refinement",
		"target_type", "projection", "id", parentID, "source_snapshot_id", sourceSnapshotID,
		"edit_id", res.Edit.ID)
	return res, nil
}

func ReviseProposalEdit(ctx context.Context, app core.App, parentID, sourceSnapshotID, editID, replacement string) (EditResult, error) {
	replacement = strings.TrimSpace(replacement)
	var res EditResult
	err := app.RunInTransaction(func(tx core.App) error {
		_, src, err := loadPendingCandidate(tx, parentID, sourceSnapshotID, "revise edit")
		if err != nil {
			return err
		}

		edits := engine.LoadSnapshotEdits(src)
		oldIdx := -1
		for i, e := range edits {
			if e.ID == editID {
				oldIdx = i
				break
			}
		}
		if oldIdx == -1 {
			return fmt.Errorf("%w: %q", ErrEditNotFound, editID)
		}

		oldEdit := edits[oldIdx]
		if oldEdit.Status != api.EditStatusProposed {
			return fmt.Errorf("%w: %s", ErrEditAlreadyResolved, oldEdit.Status)
		}
		if oldEdit.ContentAfter == replacement {
			return fmt.Errorf("%w: %w", ErrEditRejected, ErrEditNoChange)
		}

		draft := src.GetString("output_draft")
		if draft == "" {
			draft = src.GetString("output")
		}

		oldMarker := engine.FormatEditMarker(oldEdit.ID)
		if !strings.Contains(draft, oldMarker) {
			return fmt.Errorf("%w: %q", ErrTargetNotFound, oldMarker)
		}

		now := time.Now().UTC().Format(time.RFC3339)
		newID := security.RandomString(15)
		newMarker := engine.FormatEditMarker(newID)

		edits[oldIdx].Status = api.EditStatusSuperseded
		edits[oldIdx].SupersededBy = newID
		edits[oldIdx].UpdatedAt = now

		newEdit := api.SnapshotEdit{
			ID:            newID,
			Sequence:      len(edits) + 1,
			Type:          api.EditTypeRefinement,
			Status:        api.EditStatusProposed,
			ContentBefore: oldEdit.ContentBefore,
			ContentAfter:  replacement,
			BlockIndex:    oldEdit.BlockIndex,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		edits = append(edits, newEdit)

		newDraft := strings.Replace(draft, oldMarker, newMarker, 1)

		src.Set("output_draft", newDraft)
		edits = recomputeUndoable(newDraft, edits)
		src.Set("edits", pbutil.JSONObject(edits))
		if err := tx.Save(src); err != nil {
			return fmt.Errorf("revise edit: update candidate: %w", err)
		}

		res = EditResult{Edit: newEdit}
		return nil
	})
	if err != nil {
		return EditResult{}, err
	}
	logger().Info("candidate edit revised by refinement",
		"target_type", "projection", "id", parentID, "source_snapshot_id", sourceSnapshotID,
		"old_edit_id", editID, "new_edit_id", res.Edit.ID)
	return res, nil
}

func recordRefinementNotice(ctx context.Context, tx core.App, projectionID, snapshotID, msgID, partType, text string, data any) error {
	refRecs, err := tx.FindRecordsByFilter(
		schema.ColProjectionRefinement.String(),
		"projection_id = {:pid} && projection_snapshot_id = {:sid}",
		"-created",
		1,
		0,
		dbx.Params{"pid": projectionID, "sid": snapshotID},
	)
	if err != nil || len(refRecs) == 0 {
		return nil
	}
	raw, _ := json.Marshal(data)
	msg := api.UIMessage{
		ID:   msgID,
		Role: "system",
		Parts: []api.UIMessagePart{
			{
				Type: partType,
				Text: text,
				Data: raw,
			},
		},
	}
	_, err = chat.PersistMessage(ctx, tx, refRecs[0], msg, "")
	return err
}

func RecordHandEditNotice(ctx context.Context, tx core.App, projectionID, snapshotID string, edit api.SnapshotEdit) error {
	return recordRefinementNotice(
		ctx, tx, projectionID, snapshotID,
		fmt.Sprintf("hand-edit-%s", edit.ID),
		prompts.HandEditPartType,
		prompts.HandEditNotice(edit.ContentBefore, edit.ContentAfter),
		map[string]any{
			"editId":   edit.ID,
			"sequence": edit.Sequence,
			"before":   edit.ContentBefore,
			"after":    edit.ContentAfter,
		},
	)
}

func RecordEditTriageNotice(ctx context.Context, tx core.App, projectionID, snapshotID string, edit api.SnapshotEdit, status api.SnapshotEditStatus) error {
	return recordRefinementNotice(
		ctx, tx, projectionID, snapshotID,
		fmt.Sprintf("triage-edit-%s-%s", edit.ID, status),
		prompts.EditTriagePartType,
		prompts.EditTriageNotice(edit.Sequence, string(status)),
		map[string]any{
			"editId":   edit.ID,
			"sequence": edit.Sequence,
			"status":   status,
		},
	)
}

func appendUnique(ids []string, id string) []string {
	if slices.Contains(ids, id) {
		return ids
	}
	return append(ids, id)
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func recomputeUndoable(draft string, edits []api.SnapshotEdit) []api.SnapshotEdit {
	blocks := engine.SegmentMarkdownBlocks(draft)
	for i := range edits {
		e := &edits[i]
		if e.Status != api.EditStatusApproved && e.Status != api.EditStatusRejected {
			continue
		}
		if e.Undoable == nil || !*e.Undoable {
			continue
		}
		if e.InlinedText != "" {
			if !strings.Contains(draft, e.InlinedText) {
				f := false
				e.Undoable = &f
				e.UndoReason = "another edit was made on top"
			}
		} else {
			adjacent := false
			if e.AnchorPrev == api.AnchorStartSentinel && e.AnchorNext == api.AnchorEndSentinel {
				adjacent = len(blocks) == 0
			} else if e.AnchorPrev == api.AnchorStartSentinel {
				adjacent = len(blocks) > 0 && blocks[0] == e.AnchorNext
			} else if e.AnchorNext == api.AnchorEndSentinel {
				adjacent = len(blocks) > 0 && blocks[len(blocks)-1] == e.AnchorPrev
			} else {
				for j := 0; j < len(blocks)-1; j++ {
					if blocks[j] == e.AnchorPrev && blocks[j+1] == e.AnchorNext {
						adjacent = true
						break
					}
				}
			}
			if !adjacent {
				f := false
				e.Undoable = &f
				e.UndoReason = "another edit was made on top"
			}
		}
	}
	return edits
}

func UpdateSnapshotEditStatus(ctx context.Context, app core.App, parentID, sourceSnapshotID, editID string, status api.SnapshotEditStatus) (api.SnapshotEdit, error) {
	if status != api.EditStatusApproved && status != api.EditStatusRejected && status != api.EditStatusProposed {
		return api.SnapshotEdit{}, fmt.Errorf("%w: %s", ErrInvalidEditStatus, status)
	}

	var updated api.SnapshotEdit
	err := app.RunInTransaction(func(tx core.App) error {
		_, src, err := loadPendingCandidate(tx, parentID, sourceSnapshotID, "edit status")
		if err != nil {
			return err
		}

		edits := engine.LoadSnapshotEdits(src)
		editIdx := -1
		for i := range edits {
			if edits[i].ID == editID {
				editIdx = i
				break
			}
		}
		if editIdx == -1 {
			return fmt.Errorf("%w: %s", ErrEditNotFound, editID)
		}

		draft := src.GetString("output_draft")

		if status == api.EditStatusProposed {
			if edits[editIdx].Status != api.EditStatusApproved && edits[editIdx].Status != api.EditStatusRejected {
				return fmt.Errorf("%w: %s", ErrInvalidEditStatus, edits[editIdx].Status)
			}
			if edits[editIdx].Undoable == nil || !*edits[editIdx].Undoable {
				reason := edits[editIdx].UndoReason
				if reason == "" {
					reason = "edit is not undoable"
				}
				return fmt.Errorf("%w: %s", ErrEditNotUndoable, reason)
			}

			blocks := engine.SegmentMarkdownBlocks(draft)
			target := edits[editIdx]
			marker := engine.FormatEditMarker(editID)
			var newDraft string

			if target.InlinedText != "" {
				inlinedBlocks := engine.SegmentMarkdownBlocks(target.InlinedText)
				if len(inlinedBlocks) > 0 {
					var matches []int
					for k := 0; k <= len(blocks)-len(inlinedBlocks); k++ {
						match := true
						for sub := 0; sub < len(inlinedBlocks); sub++ {
							if blocks[k+sub] != inlinedBlocks[sub] {
								match = false
								break
							}
						}
						if match {
							matches = append(matches, k)
						}
					}
					if len(matches) > 0 {
						bestK := matches[0]
						bestDiff := abs(bestK - target.BlockIndex)
						for _, k := range matches[1:] {
							diff := abs(k - target.BlockIndex)
							if diff < bestDiff {
								bestDiff = diff
								bestK = k
							}
						}
						var newBlocks []string
						newBlocks = append(newBlocks, blocks[:bestK]...)
						newBlocks = append(newBlocks, marker)
						newBlocks = append(newBlocks, blocks[bestK+len(inlinedBlocks):]...)
						newDraft = joinMarkdownBlocks(newBlocks)
					} else if len(inlinedBlocks) == 1 {
						var subMatches []int
						for k, b := range blocks {
							if strings.Contains(b, target.InlinedText) {
								subMatches = append(subMatches, k)
							}
						}
						if len(subMatches) > 0 {
							bestK := subMatches[0]
							bestDiff := abs(bestK - target.BlockIndex)
							for _, k := range subMatches[1:] {
								diff := abs(k - target.BlockIndex)
								if diff < bestDiff {
									bestDiff = diff
									bestK = k
								}
							}
							var newBlocks []string
							for k, b := range blocks {
								if k == bestK {
									newBlocks = append(newBlocks, strings.Replace(b, target.InlinedText, marker, 1))
								} else {
									newBlocks = append(newBlocks, b)
								}
							}
							newDraft = joinMarkdownBlocks(newBlocks)
						}
					}
				}
				if newDraft == "" {
					f := false
					edits[editIdx].Undoable = &f
					edits[editIdx].UndoReason = "another edit was made on top"
					return fmt.Errorf("%w: inlined text not found in draft", ErrEditNotUndoable)
				}
			} else {
				var newBlocks []string
				if target.AnchorPrev == api.AnchorStartSentinel && target.AnchorNext == api.AnchorEndSentinel {
					newBlocks = []string{marker}
				} else if target.AnchorPrev == api.AnchorStartSentinel {
					if len(blocks) == 0 || blocks[0] != target.AnchorNext {
						f := false
						edits[editIdx].Undoable = &f
						edits[editIdx].UndoReason = "another edit was made on top"
						return fmt.Errorf("%w: anchor blocks not found or not adjacent", ErrEditNotUndoable)
					}
					newBlocks = append([]string{marker}, blocks...)
				} else if target.AnchorNext == api.AnchorEndSentinel {
					if len(blocks) == 0 || blocks[len(blocks)-1] != target.AnchorPrev {
						f := false
						edits[editIdx].Undoable = &f
						edits[editIdx].UndoReason = "another edit was made on top"
						return fmt.Errorf("%w: anchor blocks not found or not adjacent", ErrEditNotUndoable)
					}
					newBlocks = append(blocks, marker)
				} else {
					var matches []int
					for j := 0; j < len(blocks)-1; j++ {
						if blocks[j] == target.AnchorPrev && blocks[j+1] == target.AnchorNext {
							matches = append(matches, j)
						}
					}
					if len(matches) == 0 {
						f := false
						edits[editIdx].Undoable = &f
						edits[editIdx].UndoReason = "another edit was made on top"
						return fmt.Errorf("%w: anchor blocks not found or not adjacent", ErrEditNotUndoable)
					}
					bestJ := matches[0]
					bestDiff := abs(bestJ - target.BlockIndex)
					for _, j := range matches[1:] {
						diff := abs(j - target.BlockIndex)
						if diff < bestDiff {
							bestDiff = diff
							bestJ = j
						}
					}
					newBlocks = append(newBlocks, blocks[:bestJ+1]...)
					newBlocks = append(newBlocks, marker)
					newBlocks = append(newBlocks, blocks[bestJ+1:]...)
				}
				newDraft = joinMarkdownBlocks(newBlocks)
			}

			now := time.Now().UTC().Format(time.RFC3339)
			edits[editIdx].Status = api.EditStatusProposed
			edits[editIdx].InlinedText = ""
			edits[editIdx].AnchorPrev = ""
			edits[editIdx].AnchorNext = ""
			edits[editIdx].Undoable = nil
			edits[editIdx].UndoReason = ""
			edits[editIdx].UpdatedAt = now
			updated = edits[editIdx]

			edits = recomputeUndoable(newDraft, edits)

			src.Set("output_draft", newDraft)
			src.Set("edits", pbutil.JSONObject(edits))
			if err := tx.Save(src); err != nil {
				return err
			}
			_ = RecordEditTriageNotice(ctx, tx, parentID, sourceSnapshotID, updated, status)
			return nil
		}

		if edits[editIdx].Status != api.EditStatusProposed {
			return fmt.Errorf("%w: %s", ErrEditAlreadyResolved, editID)
		}

		marker := engine.FormatEditMarker(editID)
		if !strings.Contains(draft, marker) {
			return fmt.Errorf("%w: marker for %s not found in draft", ErrEditNotFound, editID)
		}

		replacement := edits[editIdx].ContentAfter
		if status == api.EditStatusRejected {
			replacement = edits[editIdx].ContentBefore
		}

		blocks := engine.SegmentMarkdownBlocks(draft)
		markerIdx := -1
		for i, b := range blocks {
			if strings.Contains(b, marker) {
				markerIdx = i
				break
			}
		}
		if markerIdx == -1 {
			return fmt.Errorf("%w: marker for %s not found in draft", ErrEditNotFound, editID)
		}

		var anchorPrev, anchorNext string
		if markerIdx == 0 {
			anchorPrev = api.AnchorStartSentinel
		} else {
			anchorPrev = blocks[markerIdx-1]
		}
		if markerIdx == len(blocks)-1 {
			anchorNext = api.AnchorEndSentinel
		} else {
			anchorNext = blocks[markerIdx+1]
		}

		tVal := true
		edits[editIdx].InlinedText = replacement
		edits[editIdx].AnchorPrev = anchorPrev
		edits[editIdx].AnchorNext = anchorNext
		edits[editIdx].BlockIndex = markerIdx
		edits[editIdx].Undoable = &tVal
		edits[editIdx].UndoReason = ""

		var newBlocks []string
		for i, b := range blocks {
			if i == markerIdx {
				if strings.TrimSpace(b) == marker {
					newBlocks = append(newBlocks, replacement)
				} else {
					newBlocks = append(newBlocks, strings.Replace(b, marker, replacement, 1))
				}
			} else {
				newBlocks = append(newBlocks, b)
			}
		}
		newDraft := joinMarkdownBlocks(newBlocks)

		now := time.Now().UTC().Format(time.RFC3339)
		edits[editIdx].Status = status
		edits[editIdx].UpdatedAt = now
		updated = edits[editIdx]

		edits = recomputeUndoable(newDraft, edits)

		src.Set("output_draft", newDraft)
		src.Set("edits", pbutil.JSONObject(edits))
		if err := tx.Save(src); err != nil {
			return err
		}
		_ = RecordEditTriageNotice(ctx, tx, parentID, sourceSnapshotID, updated, status)
		return nil
	})
	if err != nil {
		return api.SnapshotEdit{}, err
	}
	return updated, nil
}
