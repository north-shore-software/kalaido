package llmcontext

type PinnedIDs struct {
	FragmentIDs []string `json:"fragmentIds,omitempty"`
	SnapshotIDs []string `json:"snapshotIds,omitempty"`
}

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
