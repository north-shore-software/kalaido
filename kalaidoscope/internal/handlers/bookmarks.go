package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

// findChatConversation resolves the {cid} path segment to a plain chat. A
// refinement's client id, or a chat that has not sent its first turn, is
// simply not found — neither has bookmarks.
func findChatConversation(app core.App, e *core.RequestEvent) (*core.Record, error) {
	cid := e.Request.PathValue("cid")
	if cid == "" {
		return nil, e.BadRequestError("missing conversation id", nil)
	}
	conv, err := chat.FindConversation(app, cid)
	if err != nil {
		return nil, e.NotFoundError("conversation not found", err)
	}
	return conv, nil
}

// HandleBookmarkMessage sets or clears one message's bookmark. The message
// is addressed by its UIMessage id; a turn still streaming has no row yet
// and is not found.
func HandleBookmarkMessage(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conv, err := findChatConversation(app, e)
		if err != nil {
			return err
		}
		mid := e.Request.PathValue("mid")
		if mid == "" {
			return e.BadRequestError("missing message id", nil)
		}
		var req api.BookmarkRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid bookmark body", err)
		}

		rec, err := chat.FindMessage(app, conv, mid)
		if err != nil {
			return e.NotFoundError("message not saved yet", err)
		}
		if m, err := chat.MessageFromRecord(rec); err != nil || m.Role == "system" {
			return e.Error(http.StatusUnprocessableEntity, "only chat turns can be bookmarked", nil)
		}
		rec.Set("bookmarked", req.Bookmarked)
		if err := app.Save(rec); err != nil {
			return e.InternalServerError("failed to save bookmark", err)
		}
		return e.JSON(http.StatusOK, chat.MarkOf(rec))
	}
}

// HandleSaveBookmarks saves every bookmarked turn of the conversation as a
// fragment (see chat.SaveBookmarks). Safe to call again: turns already saved
// come back with their existing fragment and created=false.
func HandleSaveBookmarks(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conv, err := findChatConversation(app, e)
		if err != nil {
			return err
		}
		// Detached from the request: a save that is half-committed when the
		// client goes away should finish, not roll back.
		saved, err := chat.SaveBookmarks(context.WithoutCancel(e.Request.Context()), app, conv)
		if err != nil {
			return e.InternalServerError("failed to save bookmarks", err)
		}
		return e.JSON(http.StatusOK, api.SaveBookmarksResponse{Saved: saved})
	}
}

// HandleChatBrief asks the model what projection the conversation was
// working towards: a name and the opening message its drafter will get.
// Nothing is created; the client shows the brief for editing first.
func HandleChatBrief(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conv, err := findChatConversation(app, e)
		if err != nil {
			return err
		}
		brief, err := chat.GenerateBrief(e.Request.Context(), app, conv)
		if errors.Is(err, usage.ErrExhausted) {
			return usage.WriteExhausted(e, app)
		}
		if usage.WriteProviderError(e, err) {
			return nil
		}
		if errors.Is(err, engine.ErrContextTooLarge) || errors.Is(err, chat.ErrNoBrief) {
			return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
		}
		if err != nil {
			return e.InternalServerError("failed to write the brief", err)
		}
		return e.JSON(http.StatusOK, api.BriefResponse{Name: brief.Name, Message: brief.Message})
	}
}
