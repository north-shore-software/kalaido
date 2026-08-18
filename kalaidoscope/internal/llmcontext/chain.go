package llmcontext

import stdctx "context"

// ChainOriginGenerateAll marks work belonging to a speculative "generate all"
// wave: the whole stale set is generated up front, each entity consuming its
// upstreams' latest output whether or not it has been approved yet, so the user
// can click-approve down the chain without waiting on generation.
const ChainOriginGenerateAll = "generate_all"

type chainOriginKey struct{}

// WithChainOrigin marks ctx as belonging to a speculative chain wave. Two
// things read it: spec resolution switches to latest candidate-or-approved for
// upstream snapshots (see resolve.go), and snapshot writes stamp the origin
// into the record's chain_origin field for provenance and propagation.
//
// It lives here rather than in engine because resolution is the lower layer:
// engine imports llmcontext, not the reverse.
func WithChainOrigin(ctx stdctx.Context, origin string) stdctx.Context {
	return stdctx.WithValue(ctx, chainOriginKey{}, origin)
}

// ChainOriginFromContext returns the chain origin marked on ctx, or "" for
// ordinary (non-speculative) work.
func ChainOriginFromContext(ctx stdctx.Context) string {
	if v, ok := ctx.Value(chainOriginKey{}).(string); ok {
		return v
	}
	return ""
}
