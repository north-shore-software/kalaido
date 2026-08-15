package api

// CreateRefinementRequest opens a refinement session over a projection or
// reflection.
//
// A session can be *seeded*, which is how authoring flows that start from
// something existing — graduating a fragment, forking a projection — open a
// session that already has a context and a draft, without spending a model call
// to produce either.
type CreateRefinementRequest struct {
	ClientID string `json:"clientId"`
	// Scopes the session to an existing snapshot, whose context (and window, for
	// reflections) seeds the conversation.
	SnapshotID string `json:"snapshotId"`

	// ContextSpec seeds the conversation's context directly. Takes precedence
	// over the snapshot's own, so a session can start from a context that no
	// snapshot has ever been generated against.
	ContextSpec *ContextSpec `json:"contextSpec,omitempty"`
	// SeedDraft opens the session with a draft already in hand, recorded as if
	// the assistant had produced it. Committing distills it into a lens exactly
	// like a drafted one, so text that came from elsewhere can become a
	// projection without being regenerated first.
	SeedDraft string `json:"seedDraft,omitempty"`
}

type CreateRefinementResponse struct {
	RefinementID string `json:"refinementId"`
	// The messages seeded onto the new conversation, with the ids they were
	// persisted under. Callers must display these rather than reconstructing
	// their own copies, or the next turn will persist duplicates.
	Messages []UIMessage `json:"messages,omitempty"`
}
