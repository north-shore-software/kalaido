package engine

import (
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

// ResolveDraftBaseline is the draft as the reader currently sees it, with
// every remaining edit marker replaced by the passage it stands in for: a
// proposal not yet decided shows its original text, a pure insertion shows
// nothing. Accepted and rejected edits are already inlined in the draft, so
// the result is the standing text a regeneration should be compared against.
func ResolveDraftBaseline(draft string, edits []api.SnapshotEdit) string {
	if !HasUnresolvedEditMarkers(draft) {
		return draft
	}
	for _, e := range edits {
		marker := FormatEditMarker(e.ID)
		if !strings.Contains(draft, marker) {
			continue
		}
		draft = strings.ReplaceAll(draft, marker, e.ContentBefore)
	}
	// A dropped insertion leaves an empty block behind; re-segmenting folds
	// it away and normalises the blank lines between the rest.
	return strings.Join(SegmentMarkdownBlocks(draft), "\n\n")
}

// BlockRunIndex is the index of the first block at which text, itself a run
// of one or more blocks, appears verbatim in draft, or -1. A single-block
// text that sits inside a larger block (a passage inlined mid-block) resolves
// to that block's index.
func BlockRunIndex(draft, text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return -1
	}
	blocks := SegmentMarkdownBlocks(draft)
	run := SegmentMarkdownBlocks(text)
	if len(run) == 0 || len(run) > len(blocks) {
		return -1
	}
	for i := 0; i+len(run) <= len(blocks); i++ {
		match := true
		for j := range run {
			if blocks[i+j] != run[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	if len(run) == 1 {
		for i, b := range blocks {
			if strings.Contains(b, run[0]) {
				return i
			}
		}
	}
	return -1
}
