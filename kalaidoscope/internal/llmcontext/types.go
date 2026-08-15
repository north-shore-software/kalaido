package llmcontext

// PinnedIDs is a resolved context: exactly which fragments and upstream
// snapshots a spec came out to. It is the receipt stored on a snapshot, and the
// thing staleness diffs against.
type PinnedIDs struct {
	FragmentIDs []string `json:"fragmentIds,omitempty"`
	SnapshotIDs []string `json:"snapshotIds,omitempty"`

	// Focus, when set, is the part of this context the work is about; the fields
	// above are then the background around it. It never has a Focus of its own.
	//
	// This is a *presentation* split, not a membership one: focused items are as
	// much a part of the context as any other, which is why everything that asks
	// "what went in?" goes through All.
	Focus *PinnedIDs `json:"focus,omitempty"`
}

// All flattens focus back in, yielding the whole context as one set. Staleness,
// diffing, and the resolved-context receipt all work on this — only prompt
// rendering looks at the split.
func (p PinnedIDs) All() PinnedIDs {
	flat := PinnedIDs{FragmentIDs: p.FragmentIDs, SnapshotIDs: p.SnapshotIDs}
	if p.Focus == nil {
		return flat
	}
	return PinnedIDs{
		FragmentIDs: union(flat.FragmentIDs, p.Focus.FragmentIDs),
		SnapshotIDs: union(flat.SnapshotIDs, p.Focus.SnapshotIDs),
	}
}

// Background is everything outside the focus — this set with its focus dropped.
func (p PinnedIDs) Background() PinnedIDs {
	return PinnedIDs{FragmentIDs: p.FragmentIDs, SnapshotIDs: p.SnapshotIDs}
}

// FocusOrEmpty is the focused subset, or an empty set when there is no focus.
func (p PinnedIDs) FocusOrEmpty() PinnedIDs {
	if p.Focus == nil {
		return PinnedIDs{}
	}
	return p.Focus.Background()
}

// IsEmpty reports whether this set names anything at all, focus included.
func (p PinnedIDs) IsEmpty() bool {
	all := p.All()
	return len(all.FragmentIDs) == 0 && len(all.SnapshotIDs) == 0
}

// Diff is what this context has that `other` doesn't, flattened — a focused item
// is new because it wasn't there before, not because it became the focus.
func (p PinnedIDs) Diff(other PinnedIDs) PinnedIDs {
	a, b := p.All(), other.All()
	return PinnedIDs{
		FragmentIDs: diffStringSlices(a.FragmentIDs, b.FragmentIDs),
		SnapshotIDs: diffStringSlices(a.SnapshotIDs, b.SnapshotIDs),
	}
}

// Without removes everything named by `other`, flattening both sides.
func (p PinnedIDs) Without(other PinnedIDs) PinnedIDs {
	return p.Diff(other)
}

func diffStringSlices(a, b []string) []string {
	bMap := make(map[string]bool, len(b))
	for _, s := range b {
		bMap[s] = true
	}
	var diff []string
	for _, s := range a {
		if !bMap[s] {
			diff = append(diff, s)
		}
	}
	return diff
}

// union concatenates without repeating, preserving first-seen order.
func union(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	for _, s := range append(append([]string(nil), a...), b...) {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
