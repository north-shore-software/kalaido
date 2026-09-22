package pbutil

import "strings"

func SampleEvenly(idxs []int, n int) []int {
	if len(idxs) <= n {
		return idxs
	}
	out := make([]int, 0, n)
	for k := 0; k < n; k++ {
		out = append(out, idxs[k*len(idxs)/n])
	}
	return out
}

func Union(a, b []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, id := range append(append([]string{}, a...), b...) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
