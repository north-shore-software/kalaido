package llmcontext

import stdctx "context"

type settleUnchangedKey struct{}

// WithSettleUnchanged marks ctx as a fold-in: an interactive regeneration whose
// intent is "bring this entity up to date", not "show me the result". A
// no-change result then settles the approved snapshot in place instead of
// parking an identical candidate.
func WithSettleUnchanged(ctx stdctx.Context) stdctx.Context {
	return stdctx.WithValue(ctx, settleUnchangedKey{}, true)
}

// SettleUnchangedFromContext reports whether ctx carries the fold-in mark.
func SettleUnchangedFromContext(ctx stdctx.Context) bool {
	v, _ := ctx.Value(settleUnchangedKey{}).(bool)
	return v
}
