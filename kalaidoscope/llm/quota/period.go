package quota

import "time"

// PeriodKey is the usage period a moment falls in — the key usage rows are
// filed under. Shared with the cloud binary's allowance, which reads those
// rows, so both sides agree on the boundary.
func PeriodKey(t time.Time) string { return t.UTC().Format("2006-01") }
