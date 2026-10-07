package usage

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/dbutils"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/quota"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func logger() *slog.Logger {
	return slog.Default().With("component", "usage")
}

var ErrExhausted = errors.New("quota exhausted")

func Setup(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := requireUsagePeriodIndex(app); err != nil {
			return fmt.Errorf("usage.Setup: %w", err)
		}
		return se.Next()
	})
}

func requireUsagePeriodIndex(app core.App) error {
	c, err := app.FindCollectionByNameOrId(schema.ColUsage.String())
	if err != nil {
		return fmt.Errorf("usage collection missing: %w", err)
	}
	if _, ok := dbutils.FindSingleColumnUniqueIndex(c.Indexes, "period"); !ok {
		return errors.New("usage.period requires a UNIQUE index to prevent duplicate-row races on first write of a new period")
	}
	return nil
}

func currentPeriodUsed(app core.App) int64 {
	return int64(CurrentPeriod(app).TotalTokens)
}

// Period is one usage row: the tokens spent in a calendar month, split the
// way providers bill them. CachedTokens is the part of PromptTokens served
// from the provider's cache; CompletionTokens includes any thinking tokens.
type Period struct {
	Period           string `json:"period"`
	PromptTokens     int    `json:"promptTokens"`
	CachedTokens     int    `json:"cachedTokens"`
	CompletionTokens int    `json:"completionTokens"`
	TotalTokens      int    `json:"totalTokens"`
}

// CurrentPeriod reads this month's usage; a month with no calls yet is all zeros.
func CurrentPeriod(app core.App) Period {
	p := Period{Period: quota.PeriodKey(time.Now())}
	rec, err := app.FindFirstRecordByData(schema.ColUsage.String(), "period", p.Period)
	if err != nil {
		return p
	}
	p.PromptTokens = rec.GetInt("prompt_tokens")
	p.CachedTokens = rec.GetInt("cached_tokens")
	p.CompletionTokens = rec.GetInt("completion_tokens")
	p.TotalTokens = rec.GetInt("total_tokens")
	return p
}

func Authorized(ctx context.Context, app core.App) error {
	a := quota.Get()
	if a == nil {
		return nil
	}
	if !a.Allowed(ctx, app) {
		return ErrExhausted
	}
	return nil
}

func Record(ctx context.Context, app core.App, u *llm.Usage) {
	if u == nil || u.TotalTokens == 0 {
		return
	}
	period := quota.PeriodKey(time.Now())
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		lastErr = app.RunInTransaction(func(txApp core.App) error {
			rec, err := txApp.FindFirstRecordByData(schema.ColUsage.String(), "period", period)
			if err != nil {
				col, e := txApp.FindCollectionByNameOrId(schema.ColUsage.String())
				if e != nil {
					return e
				}
				rec = core.NewRecord(col)
				rec.Set("period", period)
			}
			rec.Set("prompt_tokens", rec.GetInt("prompt_tokens")+u.PromptTokens)
			rec.Set("completion_tokens", rec.GetInt("completion_tokens")+u.CompletionTokens)
			rec.Set("total_tokens", rec.GetInt("total_tokens")+u.TotalTokens)
			rec.Set("cached_tokens", rec.GetInt("cached_tokens")+u.CachedTokens)
			return txApp.Save(rec)
		})
		if lastErr == nil {
			break
		}
	}
	if lastErr != nil {
		logger().Error("record usage failed", "period", period, "error", lastErr)
	}
	if a := quota.Get(); a != nil {
		a.Record(ctx, app, int64(u.TotalTokens))
	}
}
func WriteExhausted(e *core.RequestEvent, app core.App) error {
	return e.JSON(http.StatusPaymentRequired, map[string]any{
		"error":  "quota_exhausted",
		"period": quota.PeriodKey(time.Now()),
		"used":   currentPeriodUsed(app),
	})
}
