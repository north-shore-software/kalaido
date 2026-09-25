package api

type SnapshotEditStatus string

const (
	EditStatusProposed   SnapshotEditStatus = "proposed"
	EditStatusApproved   SnapshotEditStatus = "approved"
	EditStatusRejected   SnapshotEditStatus = "rejected"
	EditStatusSuperseded SnapshotEditStatus = "superseded"
)

type SnapshotEditType string

const (
	EditTypeRegeneration SnapshotEditType = "regeneration"
	EditTypeRefinement   SnapshotEditType = "refinement"
	EditTypeManual       SnapshotEditType = "manual"
)

const (
	AnchorStartSentinel = "^START^"
	AnchorEndSentinel   = "^END^"
)

type SnapshotEdit struct {
	ID            string             `json:"id"`
	Sequence      int                `json:"sequence"`
	Type          SnapshotEditType   `json:"type"`
	Status        SnapshotEditStatus `json:"status"`
	ContentBefore string             `json:"contentBefore"`
	ContentAfter  string             `json:"contentAfter"`
	BlockIndex    int                `json:"blockIndex"`
	FragmentID    string             `json:"fragmentId,omitempty"`
	InlinedText   string             `json:"inlinedText,omitempty"`
	AnchorPrev    string             `json:"anchorPrev,omitempty"`
	AnchorNext    string             `json:"anchorNext,omitempty"`
	SupersededBy  string             `json:"supersededBy,omitempty"`
	Undoable      *bool              `json:"undoable,omitempty"`
	UndoReason    string             `json:"undoReason,omitempty"`
	CreatedAt     string             `json:"createdAt"`
	UpdatedAt     string             `json:"updatedAt,omitempty"`
}
