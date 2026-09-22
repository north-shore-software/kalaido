// UNREVIEWED
package schema

import (
	"encoding/json"
	"sort"

	"github.com/pocketbase/pocketbase/core"
)

// Snapshot is the schema of a database in a form two databases can be
// compared by: every collection as PocketBase serialises it, minus the parts
// that legitimately differ between two databases with the same schema —
// collection and field ids, timestamps — with relation targets named
// instead of id'd and indexes in a fixed order.
func Snapshot(app core.App) ([]map[string]any, error) {
	cols, err := app.FindAllCollections()
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	for _, c := range cols {
		names[c.Id] = c.Name
	}
	out := make([]map[string]any, 0, len(cols))
	for _, c := range cols {
		raw, err := json.Marshal(c)
		if err != nil {
			return nil, err
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		delete(m, "id")
		delete(m, "created")
		delete(m, "updated")
		if fields, ok := m["fields"].([]any); ok {
			for _, f := range fields {
				fm, ok := f.(map[string]any)
				if !ok {
					continue
				}
				delete(fm, "id")
				if id, ok := fm["collectionId"].(string); ok {
					if n, ok := names[id]; ok {
						fm["collectionId"] = n
					}
				}
			}
		}
		if idx, ok := m["indexes"].([]any); ok {
			strs := make([]string, 0, len(idx))
			for _, i := range idx {
				if s, ok := i.(string); ok {
					strs = append(strs, s)
				}
			}
			sort.Strings(strs)
			m["indexes"] = strs
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i]["name"].(string) < out[j]["name"].(string)
	})
	return out, nil
}
