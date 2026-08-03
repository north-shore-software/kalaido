package usage

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/dbutils"

	"github.com/north-shore-software/kalaido/llm"
	"github.com/north-shore-software/kalaido/quota"
	"github.com/north-shore-software/kalaido/timeutil"
)

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
	c, err := app.FindCollectionByNameOrId("usage")
	if err != nil {
		return fmt.Errorf("usage collection missing: %w", err)
	}
	if _, ok := dbutils.FindSingleColumnUniqueIndex(c.Indexes, "period"); !ok {
		return errors.New("usage.period requires a UNIQUE index to prevent duplicate-row races on first write of a new period")
	}
	return nil
}

func currentPeriodUsed(app core.App) int64 {
	rec, err := app.FindFirstRecordByData("usage", "period", timeutil.PeriodKey(time.Now()))
	if err != nil {
		return 0
	}
	return int64(rec.GetInt("total_tokens"))
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
	period := timeutil.PeriodKey(time.Now())
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		lastErr = app.RunInTransaction(func(txApp core.App) error {
			rec, err := txApp.FindFirstRecordByData("usage", "period", period)
			if err != nil {
				col, e := txApp.FindCollectionByNameOrId("usage")
				if e != nil {
					return e
				}
				rec = core.NewRecord(col)
				rec.Set("period", period)
			}
			rec.Set("prompt_tokens", rec.GetInt("prompt_tokens")+u.PromptTokens)
			rec.Set("completion_tokens", rec.GetInt("completion_tokens")+u.CompletionTokens)
			rec.Set("total_tokens", rec.GetInt("total_tokens")+u.TotalTokens)
			return txApp.Save(rec)
		})
		if lastErr == nil {
			break
		}
	}
	if lastErr != nil {
		log.Printf("usage: record %s: %v", period, lastErr)
	}
	if a := quota.Get(); a != nil {
		a.Record(ctx, app, int64(u.TotalTokens))
	}
}
func WriteExhausted(e *core.RequestEvent, app core.App) error {
	return e.JSON(http.StatusPaymentRequired, map[string]any{
		"error":  "quota_exhausted",
		"period": timeutil.PeriodKey(time.Now()),
		"used":   currentPeriodUsed(app),
	})
}
