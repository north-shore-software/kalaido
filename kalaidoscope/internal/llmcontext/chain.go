package llmcontext

import stdctx "context"

// TriggerGenerateAll marks work belonging to a speculative "generate all"
// wave: the whole stale set is generated up front, each entity consuming its
// upstreams' latest output whether or not it has been approved yet, so the user
// can click-approve down the chain without waiting on generation.
const TriggerGenerateAll = "generate_all"

type generationTriggerKey struct{}

// WithGenerationTrigger marks ctx as belonging to a speculative wave. Two
// things read it: spec resolution switches to latest candidate-or-approved for
// upstream snapshots (see resolve.go), and snapshot writes stamp the trigger
// into the record's generation_trigger field for provenance and propagation.
//
// It lives here rather than in engine because resolution is the lower layer:
// engine imports llmcontext, not the reverse.
func WithGenerationTrigger(ctx stdctx.Context, trigger string) stdctx.Context {
	return stdctx.WithValue(ctx, generationTriggerKey{}, trigger)
}

// GenerationTriggerFromContext returns the generation trigger marked on ctx, or "" for
// ordinary (non-speculative) work.
func GenerationTriggerFromContext(ctx stdctx.Context) string {
	if v, ok := ctx.Value(generationTriggerKey{}).(string); ok {
		return v
	}
	return ""
}

type settleUnchangedKey struct{}

// WithSettleUnchanged marks ctx as a fold-in: an interactive regeneration whose
// intent is "bring this entity up to date", not "show me the result". A
// no-change result then settles the approved snapshot in place instead of
// parking an identical candidate, exactly as a speculative wave would — but
// without the wave's speculative resolution (unapproved upstream candidates
// are not consumed) and without stamping generation_trigger on the row.
func WithSettleUnchanged(ctx stdctx.Context) stdctx.Context {
	return stdctx.WithValue(ctx, settleUnchangedKey{}, true)
}

// SettleUnchangedFromContext reports whether ctx carries the fold-in mark.
func SettleUnchangedFromContext(ctx stdctx.Context) bool {
	v, _ := ctx.Value(settleUnchangedKey{}).(bool)
	return v
}
