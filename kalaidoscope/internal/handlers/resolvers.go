package handlers

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/explore"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
)

// resolveCandidate extracts the projection id and candidate snapshot id from
// path values and ensures the candidate belongs to the projection.
func resolveCandidate(e *core.RequestEvent, app core.App) (string, error) {
	id := e.Request.PathValue("id")
	if id == "" {
		return "", e.BadRequestError("projection id required", nil)
	}
	rid := e.Request.PathValue("rid")
	if rid == "" {
		return "", e.BadRequestError("candidate id required", nil)
	}
	snap, err := sourcedata.FindProjectionSnapshotByID(app, rid)
	if err != nil {
		return "", e.NotFoundError("candidate not found", err)
	}
	if snap.GetString("projection_id") != id {
		return "", e.NotFoundError("candidate does not belong to this projection", nil)
	}
	return rid, nil
}

// findExploreConversation resolves the {cid} path segment to an explore conversation record.
func findExploreConversation(app core.App, e *core.RequestEvent) (*core.Record, error) {
	cid := e.Request.PathValue("cid")
	if cid == "" {
		return nil, e.BadRequestError("missing conversation id", nil)
	}
	conv, err := explore.FindConversation(app, cid)
	if err != nil {
		return nil, e.NotFoundError("conversation not found", err)
	}
	return conv, nil
}
