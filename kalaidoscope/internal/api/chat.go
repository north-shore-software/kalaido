// UNREVIEWED
package api

import "encoding/json"

type UIMessagePart struct {
	Type string          `json:"type"`
	Text string          `json:"text,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

type UIMessage struct {
	ID    string          `json:"id"`
	Role  string          `json:"role"`
	Parts []UIMessagePart `json:"parts"`
}

type ChatRequest struct {
	ID       string      `json:"id"`
	Messages []UIMessage `json:"messages"`
}

// BookmarkRequest sets or clears the bookmark on one chat message.
type BookmarkRequest struct {
	Bookmarked bool `json:"bookmarked"`
}

// MessageMark is a message's bookmark state: whether it is bookmarked and,
// once the bookmarks have been saved, the fragment it became. Keyed by the
// UIMessage id, the only id the client has for a message.
type MessageMark struct {
	MessageID  string `json:"messageId"`
	Bookmarked bool   `json:"bookmarked"`
	FragmentID string `json:"fragmentId,omitempty"`
}

// SavedBookmark is one bookmarked message after a save: the fragment it is,
// and whether this call created it or found it already saved.
type SavedBookmark struct {
	MessageID  string `json:"messageId"`
	FragmentID string `json:"fragmentId"`
	Created    bool   `json:"created"`
}

type SaveBookmarksResponse struct {
	Saved []SavedBookmark `json:"saved"`
}

// BriefResponse is the projection a chat session was working towards: a
// name and the opening message for its drafter.
type BriefResponse struct {
	Name    string `json:"name"`
	Message string `json:"message"`
}

// ToolPartData is the Data of a "tool-<name>" UIMessagePart as the client
// persists it: the call's id and the arguments the model supplied.
type ToolPartData struct {
	ToolCallID string          `json:"toolCallId"`
	Input      json.RawMessage `json:"input"`
}
