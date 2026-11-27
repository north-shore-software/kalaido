package reflections

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// MaxPreviewWindows bounds the number of newest candidate windows returned by
// PreviewWindows so the picker stays fast and bounded.
const MaxPreviewWindows = 24

var (
	// ErrEmptyLensPrompt rejects previewing or saving an empty standing lens.
	ErrEmptyLensPrompt = errors.New("lensPrompt is required")
	// ErrInvalidPreviewWindow rejects a preview request without valid window bounds.
	ErrInvalidPreviewWindow = errors.New("window with RFC3339 start and end is required")
)

// StripUpstreamSources removes upstream projection/reflection references from a
// ContextSpec because reflections consume fragments and colours only.
func StripUpstreamSources(spec api.ContextSpec) api.ContextSpec {
	spec.SourceProjectionIDs = nil
	spec.SourceReflectionIDs = nil
	return spec
}

// PreviewWindows enumerates candidate sample windows for a staged WindowSpec
// and counts matching fragments per window via fast DB resolution (zero LLM
// calls, zero database mutations).
func PreviewWindows(
	ctx context.Context,
	app core.App,
	reflectionID string,
	spec api.WindowSpec,
	ctxSpec api.ContextSpec,
	now time.Time,
) (api.PreviewReflectionWindowsResponse, error) {
	if spec.StartTime == "" && reflectionID != "" {
		if rec, err := FindLive(app, reflectionID); err == nil {
			if cur, ok := GoverningVersion(LoadWindowSpecVersions(rec), now); ok {
				spec.StartTime = cur.Spec.StartTime
			}
		}
	}
	if err := spec.Validate(); err != nil {
		return api.PreviewReflectionWindowsResponse{}, fmt.Errorf("%w: %w", ErrInvalidWindowSpec, err)
	}

	effectiveFrom := now
	if st := parseRFC3339(spec.StartTime); !st.IsZero() && st.Before(now) {
		effectiveFrom = st
	}

	candidates := GridWindows(reflectionID, spec, effectiveFrom, now)
	if len(candidates) == 0 {
		if trailing := trailingPreviewWindow(reflectionID, spec, now); trailing != nil {
			candidates = []api.Window{*trailing}
		}
	}

	if len(candidates) > MaxPreviewWindows {
		candidates = candidates[len(candidates)-MaxPreviewWindows:]
	}

	cleanSpec := StripUpstreamSources(ctxSpec)
	out := make([]api.PreviewWindowInfo, 0, len(candidates))
	for _, w := range candidates {
		winCopy := w
		fragCount := 0
		if pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, cleanSpec, &winCopy); err == nil {
			fragCount = len(pinned.FragmentIDs)
		}
		out = append(out, api.PreviewWindowInfo{
			Window:        winCopy,
			Key:           WindowKey(winCopy),
			FragmentCount: fragCount,
		})
	}

	defaultID := ""
	if len(out) > 0 {
		defaultID = out[len(out)-1].ID
	}

	return api.PreviewReflectionWindowsResponse{
		Windows:         out,
		DefaultWindowID: defaultID,
	}, nil
}

// trailingPreviewWindow builds a single "as of now" trailing window of one
// Duration when the staged schedule has not yet completed a grid point.
func trailingPreviewWindow(reflectionID string, spec api.WindowSpec, now time.Time) *api.Window {
	period := parseDurationOr(spec.Period, 0)
	duration := parseDurationOr(spec.Duration, period)
	if duration <= 0 {
		return nil
	}
	end := now.UTC().Truncate(time.Minute)
	if endCap := parseRFC3339(spec.EndTime); !endCap.IsZero() && endCap.Before(end) {
		end = endCap.UTC()
	}
	start := end.Add(-duration)
	if spec.EndTime != "" {
		if origin := parseRFC3339(spec.StartTime); !origin.IsZero() && origin.After(start) && origin.Before(end) {
			start = origin
		}
	}
	if !start.Before(end) {
		return nil
	}
	w := newWindow(reflectionID, start, end)
	return &w
}

// RunStagedPreview executes a staged standing lens strictly in isolation
// against one sample window's fragments (zero chat history, zero database
// writes). When zero fragments match the window, skips the LLM call and returns
// EmptyWindowOutput immediately.
func RunStagedPreview(
	ctx context.Context,
	app core.App,
	req api.PreviewReflectionRequest,
) (api.PreviewReflectionResponse, error) {
	lensPrompt := strings.TrimSpace(req.LensPrompt)
	if lensPrompt == "" {
		return api.PreviewReflectionResponse{}, ErrEmptyLensPrompt
	}
	startT, err := time.Parse(time.RFC3339, req.Window.Start)
	if err != nil {
		return api.PreviewReflectionResponse{}, ErrInvalidPreviewWindow
	}
	endT, err := time.Parse(time.RFC3339, req.Window.End)
	if err != nil || !startT.Before(endT) {
		return api.PreviewReflectionResponse{}, ErrInvalidPreviewWindow
	}

	cleanSpec := StripUpstreamSources(req.ContextSpec)
	win := req.Window
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, cleanSpec, &win)
	if err != nil {
		return api.PreviewReflectionResponse{}, fmt.Errorf("resolve preview context: %w", err)
	}

	fragCount := len(pinned.FragmentIDs)
	if fragCount == 0 {
		return api.PreviewReflectionResponse{
			Output:        EmptyWindowOutput,
			Empty:         true,
			FragmentCount: 0,
		}, nil
	}

	modelOverride := strings.TrimSpace(req.GenerateWithModel)
	if modelOverride == "" && req.ReflectionID != "" {
		if rec, err := FindLive(app, req.ReflectionID); err == nil {
			modelOverride = rec.GetString("generate_with_model")
		}
	}
	model, err := llm.ResolveRoleFor(llm.RoleSnapshot, modelOverride)
	if err != nil {
		return api.PreviewReflectionResponse{}, err
	}

	fragOnly := llmcontext.PinnedIDs{FragmentIDs: pinned.FragmentIDs}
	sourceBlock, err := llmcontext.HydrateIDsToText(ctx, app, fragOnly)
	if err != nil {
		return api.PreviewReflectionResponse{}, fmt.Errorf("hydrate preview context: %w", err)
	}

	output, err := engine.GenerateOutput(ctx, app, model, lensPrompt, sourceBlock, &win)
	if err != nil {
		return api.PreviewReflectionResponse{}, fmt.Errorf("preview reflection: %w", err)
	}
	if strings.TrimSpace(output) == "" {
		return api.PreviewReflectionResponse{}, errors.New("preview reflection: model returned empty output")
	}

	return api.PreviewReflectionResponse{
		Output:        strings.TrimSpace(output),
		Empty:         false,
		FragmentCount: fragCount,
	}, nil
}
