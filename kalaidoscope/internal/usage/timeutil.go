package usage

import "time"

func UsagePeriodKey(t time.Time) string { return t.UTC().Format("2006-01") }
