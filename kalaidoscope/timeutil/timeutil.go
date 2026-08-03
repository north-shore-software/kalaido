package timeutil

import "time"

func PeriodKey(t time.Time) string { return t.UTC().Format("2006-01") }
