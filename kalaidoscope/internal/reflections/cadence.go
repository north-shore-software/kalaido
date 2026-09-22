package reflections

import (
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

var CadencePeriods = map[string]string{
	"daily":     "24h",
	"weekly":    "168h",
	"monthly":   "720h",
	"quarterly": "2160h",
}

func CadenceNames() []string {
	return []string{"daily", "weekly", "monthly", "quarterly"}
}

func BuildReflectionSpec(cadence, startTime string, now time.Time) (api.WindowSpec, time.Time, string) {
	period, ok := CadencePeriods[strings.ToLower(strings.TrimSpace(cadence))]
	if !ok {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverUnknownCadence(cadence, CadenceNames())
	}
	start, ok := ParseStartDate(startTime)
	if !ok {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverBadStartTime(startTime)
	}
	if start.After(now) {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverStartInFuture(start.Format("2006-01-02"))
	}
	p, _ := time.ParseDuration(period)
	if windows := int(now.Sub(start) / p); windows > MaxGridWindows {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverTooManyWindows(windows, MaxGridWindows)
	}
	spec := api.WindowSpec{
		StartTime: start.Format(time.RFC3339),
		Period:    period,
		Duration:  period,
	}
	return spec, start, ""
}

func ParseStartDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{"2006-01-02", time.RFC3339, "2006-01"} {
		if t, err := time.Parse(layout, s); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), true
		}
	}
	return time.Time{}, false
}
