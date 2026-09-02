package api

// CreateRefinementRequest opens a refinement session over a projection or
// reflection.
//
// A session can be *seeded with context*, which is how authoring flows that
// start from something existing — graduating a fragment, forking a projection
// — open a session whose sources are already pinned. The session's document
// only comes into being when the model drafts a lens, so every session needs
// at least one chat turn before it can be committed; flows that used to seed a
// draft now send the material as the session's first user message instead.
type CreateRefinementRequest struct {
	ClientID string `json:"clientId"`
	// Projections: scopes the session to an existing snapshot, whose context
	// seeds the conversation. Ignored for reflections — a reflection's lens is
	// refined independently of any one window's snapshot.
	SnapshotID string `json:"snapshotId"`
	// Reflections: the window the preview is generated against to begin with.
	// Defaults to the reflection's current window.
	Window *Window `json:"window,omitempty"`

	// ContextSpec seeds the conversation's context directly. Takes precedence
	// over the snapshot's own, so a session can start from a context that no
	// snapshot has ever been generated against.
	ContextSpec *ContextSpec `json:"contextSpec,omitempty"`
}

type CreateRefinementResponse struct {
	RefinementID string `json:"refinementId"`
	// The messages seeded onto the new conversation, with the ids they were
	// persisted under. Callers must display these rather than reconstructing
	// their own copies, or the next turn will persist duplicates.
	Messages []UIMessage `json:"messages,omitempty"`
}
