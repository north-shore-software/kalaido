// UNREVIEWED
package pbutil

import "github.com/pocketbase/pocketbase/core"

// TogglePinnedBy adds or removes userID from the record's pinned_by string slice.
func TogglePinnedBy(rec *core.Record, userID string, pin bool) {
	pinnedBy := rec.GetStringSlice("pinned_by")
	var newPinnedBy []string
	if pin {
		hasUser := false
		for _, uid := range pinnedBy {
			if uid == userID {
				hasUser = true
			}
			newPinnedBy = append(newPinnedBy, uid)
		}
		if !hasUser {
			newPinnedBy = append(newPinnedBy, userID)
		}
	} else {
		for _, uid := range pinnedBy {
			if uid != userID {
				newPinnedBy = append(newPinnedBy, uid)
			}
		}
	}
	rec.Set("pinned_by", newPinnedBy)
}
