package llmcontext

// PinnedIDs is a resolved context: exactly which fragments and upstream
// snapshots a spec came out to. It is the receipt stored on a snapshot, and the
// thing staleness diffs against.
type PinnedIDs struct {
	FragmentIDs []string `json:"fragmentIds,omitempty"`
	SnapshotIDs []string `json:"snapshotIds,omitempty"`
}

// IsEmpty reports whether this set names anything at all.
func (p PinnedIDs) IsEmpty() bool {
	return len(p.FragmentIDs) == 0 && len(p.SnapshotIDs) == 0
}

// Diff is what this context has that `other` doesn't.
func (p PinnedIDs) Diff(other PinnedIDs) PinnedIDs {
	return PinnedIDs{
		FragmentIDs: diffStringSlices(p.FragmentIDs, other.FragmentIDs),
		SnapshotIDs: diffStringSlices(p.SnapshotIDs, other.SnapshotIDs),
	}
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
