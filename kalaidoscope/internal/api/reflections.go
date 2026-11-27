package api

import (
	"encoding/json"
	"errors"
)

type ReflectionSnapshotResponse struct {
	SnapshotIDs []string `json:"snapshotIds"`
}

type ReflectionLensResponse struct {
	LensID string `json:"lensId"`
	Prompt string `json:"prompt"`
}

type UpdateReflectionLensRequest struct {
	Prompt string `json:"prompt"`
}

type EditReflectionWindowRequest struct {
	Output string `json:"output"`
}

type EditReflectionWindowResponse struct {
	SnapshotID string `json:"snapshotId"`
}

// PreviewReflectionWindowsRequest enumerates sample windows and matching
// fragment counts for a staged schedule + context without mutating any record.
type PreviewReflectionWindowsRequest struct {
	ReflectionID string      `json:"reflectionId,omitempty"`
	WindowSpec   WindowSpec  `json:"windowSpec"`
	ContextSpec  ContextSpec `json:"contextSpec"`
}

// PreviewWindowInfo is one candidate sample window for the reflection preview
// picker, including the count of matching fragments inside its bounds.
type PreviewWindowInfo struct {
	Window
	Key           string `json:"key"`
	FragmentCount int    `json:"fragmentCount"`
}

type PreviewReflectionWindowsResponse struct {
	Windows         []PreviewWindowInfo `json:"windows"`
	DefaultWindowID string              `json:"defaultWindowId,omitempty"`
}

// PreviewReflectionRequest executes a staged standing lens strictly in
// isolation against one sample window's fragments (zero chat history, zero
// database mutations).
type PreviewReflectionRequest struct {
	ReflectionID      string      `json:"reflectionId,omitempty"`
	LensPrompt        string      `json:"lensPrompt"`
	ContextSpec       ContextSpec `json:"contextSpec"`
	Window            Window      `json:"window"`
	GenerateWithModel string      `json:"generateWithModel,omitempty"`
}

type PreviewReflectionResponse struct {
	Output        string `json:"output"`
	Empty         bool   `json:"empty"`
	FragmentCount int    `json:"fragmentCount"`
}

// SaveReflectionRequest atomically persists staged reflection tuning edits
// (schedule, context sources, standing lens, and optional name) on Save or
// refinement commit.
type SaveReflectionRequest struct {
	RefinementID string       `json:"refinementId,omitempty"`
	WindowSpec   *WindowSpec  `json:"windowSpec,omitempty"`
	ContextSpec  *ContextSpec `json:"contextSpec,omitempty"`
	LensPrompt   *string      `json:"lensPrompt,omitempty"`
	Name         *string      `json:"name,omitempty"`
}

type SaveReflectionResponse struct {
	ID         string `json:"id"`
	LensID     string `json:"lensId"`
	SnapshotID string `json:"snapshotId,omitempty"`
}

type DiscardReflectionDraftResponse struct {
	ID                 string `json:"id"`
	DeletedReflection  bool   `json:"deletedReflection,omitempty"`
	RevertedToProposed bool   `json:"revertedToProposed,omitempty"`
}

type GenerateReflectionSnapshotRequest struct {
	SourceID    string      `json:"sourceId"` // ReflectionID
	ChatID      string      `json:"chatId"`
	FragmentIDs []string    `json:"fragmentIds"`
	ColourIDs   []string    `json:"colourIds"`
	Messages    []UIMessage `json:"messages"`
	Preview     bool        `json:"preview"`
	WindowID    string      `json:"windowId,omitempty"`
	AllWindows  bool        `json:"allWindows,omitempty"`
}

func (r GenerateReflectionSnapshotRequest) Validate() error {
	if r.WindowID != "" && r.AllWindows {
		return errors.New("cannot specify both windowId and allWindows=true")
	}
	return nil
}

// UnmarshalJSON supports both "allWindows" and the legacy "all" JSON key.
func (r *GenerateReflectionSnapshotRequest) UnmarshalJSON(data []byte) error {
	type rawRequest GenerateReflectionSnapshotRequest
	var raw struct {
		rawRequest
		All bool `json:"all"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*r = GenerateReflectionSnapshotRequest(raw.rawRequest)
	if raw.All {
		r.AllWindows = true
	}
	return nil
}

type CreateReflectionResponse struct {
	ReflectionID string `json:"reflectionId"`
}

// CreateReflectionRequest is the body of POST /api/reflections.
type CreateReflectionRequest struct {
	Name string `json:"name"`
	// What this entity is for, when the creator has one to give — a chat's
	// brief. Discover writes its own; typed creates leave it empty.
	Description string `json:"description,omitempty"`
	// Reflections only: the schedule. A Start Time in the past is "summarize
	// from then": the first version is effective from it, so every grid
	// window since is pending (the backfill).
	WindowSpec *WindowSpec `json:"windowSpec,omitempty"`
}

// UpdateReflectionRequest is the body of PATCH /api/reflections/{id}.
// Every field is optional; absent fields are left untouched.
type UpdateReflectionRequest struct {
	Name *string `json:"name,omitempty"`
	// Pin or unpin the entity for the calling user.
	Pinned *bool `json:"pinned,omitempty"`
	// Reflections only: append a new schedule version.
	WindowSpec *WindowSpec `json:"windowSpec,omitempty"`
	// Per-entity model override for future generations; empty clears it.
	GenerateWithModel *string `json:"generateWithModel,omitempty"`
}

// CreateReflectionRefinementRequest opens a refinement session over a reflection.
type CreateReflectionRefinementRequest struct {
	ClientID string `json:"clientId"`
	// The window the preview is generated against to begin with.
	// Defaults to the reflection's current window.
	Window *Window `json:"window,omitempty"`
	// ContextSpec seeds the conversation's context directly.
	ContextSpec *ContextSpec `json:"contextSpec,omitempty"`
}

type CreateReflectionRefinementResponse struct {
	RefinementID string `json:"refinementId"`
	// The messages seeded onto the new conversation, with the ids they were
	// persisted under. Callers must display these rather than reconstructing
	// their own copies, or the next turn will persist duplicates.
	Messages []UIMessage `json:"messages,omitempty"`
}

type Window struct {
	ID    string `json:"id"`
	Start string `json:"start"`
	End   string `json:"end"`
}

// WindowInfo is one window of a reflection's series as served by
// GET /api/reflections/{id}/windows.
type WindowInfo struct {
	Window
	// The key snapshots for this window are filed under (start_end).
	Key         string `json:"key"`
	HasApproved bool   `json:"hasApproved"`
	Generating  bool   `json:"generating"`
	// Materialized by an explicit backfill rather than by the grid.
	Backfilled bool `json:"backfilled"`
	// Filled by the status evaluator: an approved snapshot exists but the
	// window's context has changed since it was generated.
	Stale bool `json:"stale,omitempty"`
	// The approved snapshot was produced by a lens other than the
	// reflection's current one — a refinement was committed since.
	LensOutdated bool `json:"lensOutdated,omitempty"`
}

type ReflectionWindowsResponse struct {
	Windows []WindowInfo `json:"windows"`
	// The window a new refinement defaults to (the current one); empty for
	// an unscheduled reflection.
	CurrentWindowID string `json:"currentWindowId,omitempty"`
}

type BackfillRequest struct {
	// RFC3339. Windows between it and the first one the grid already covers
	// are materialized.
	From string `json:"from"`
}

type BackfillResponse struct {
	Windows []Window `json:"windows"`
}

// ReflectionStatus is one reflection's freshness, including window state.
type ReflectionStatus struct {
	ID                 string   `json:"id"`
	Type               string   `json:"type"` // "reflection" or "projection"
	UpToDateSnapshotID string   `json:"upToDateSnapshotId,omitempty"`
	NewFragmentIDs     []string `json:"newFragmentIds,omitempty"`
	// Upstreams that have published a newer approved snapshot than the one the
	// live snapshot consumed. Regenerating now would pick up their new output.
	StaleDependencies []string `json:"staleDependencies,omitempty"`
	// Reflections: materialized windows with no approved snapshot yet.
	PendingWindows []Window `json:"pendingWindows,omitempty"`
	// Reflections: windows whose approved snapshot predates fragments that
	// now fall inside them (a backdated import, a late-arriving email).
	StaleWindows []Window         `json:"staleWindows,omitempty"`
	Candidate    *CandidateStatus `json:"candidate,omitempty"`
}

// CandidateStatus describes a projection's pending candidate for the UI:
// whether it still reflects what a generation would consume now (Outdated,
// with Reason one of engine.Currency*: new_fragments, context_changed,
// lens_changed, model_changed) and whether the user has invested in it
// (Engaged — see engine.CandidateEngaged).
type CandidateStatus struct {
	ID             string   `json:"id"`
	Outdated       bool     `json:"outdated"`
	Reason         string   `json:"reason,omitempty"`
	Engaged        bool     `json:"engaged"`
	NewFragmentIDs []string `json:"newFragmentIds,omitempty"`
}
