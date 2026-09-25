package engine

import (
	"regexp"
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/pocketbase/pocketbase/tools/security"
)

var fenceRe = regexp.MustCompile(`^\s{0,3}` + "(`{3}|~{3})")

type diffOpTag int

const (
	opEqual diffOpTag = iota
	opInsert
	opDelete
)

type diffOp struct {
	tag  diffOpTag
	text string
}

func SegmentMarkdownBlocks(md string) []string {
	var blocks []string
	var current []string
	var inFence bool

	flush := func() {
		if len(current) > 0 {
			blocks = append(blocks, strings.Join(current, "\n"))
			current = nil
		}
	}

	lines := strings.Split(md, "\n")
	for _, line := range lines {
		if fenceRe.MatchString(line) {
			current = append(current, line)
			inFence = !inFence
		} else if !inFence && strings.TrimSpace(line) == "" {
			flush()
		} else {
			current = append(current, line)
		}
	}
	flush()
	return blocks
}

func myersDiff(a, b []string) []diffOp {
	n := len(a)
	m := len(b)
	if n == 0 && m == 0 {
		return nil
	}
	if n == 0 {
		ops := make([]diffOp, m)
		for i, text := range b {
			ops[i] = diffOp{tag: opInsert, text: text}
		}
		return ops
	}
	if m == 0 {
		ops := make([]diffOp, n)
		for i, text := range a {
			ops[i] = diffOp{tag: opDelete, text: text}
		}
		return ops
	}

	max := n + m
	v := make([]int, 2*max+1)
	vOffset := max
	trace := make([][]int, 0, max+1)

	for d := 0; d <= max; d++ {
		vCopy := make([]int, len(v))
		copy(vCopy, v)
		trace = append(trace, vCopy)

		var done bool
		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || (k != d && v[k-1+vOffset] < v[k+1+vOffset]) {
				x = v[k+1+vOffset]
			} else {
				x = v[k-1+vOffset] + 1
			}
			y := x - k
			for x < n && y < m && a[x] == b[y] {
				x++
				y++
			}
			v[k+vOffset] = x
			if x >= n && y >= m {
				done = true
				break
			}
		}
		if done {
			break
		}
	}

	var ops []diffOp
	x := n
	y := m

	for d := len(trace) - 1; d > 0; d-- {
		vPrev := trace[d]
		k := x - y
		var prevK int
		if k == -d || (k != d && vPrev[k-1+vOffset] < vPrev[k+1+vOffset]) {
			prevK = k + 1
		} else {
			prevK = k - 1
		}
		prevX := vPrev[prevK+vOffset]
		prevY := prevX - prevK

		for x > prevX && y > prevY {
			x--
			y--
			ops = append(ops, diffOp{tag: opEqual, text: a[x]})
		}

		if x == prevX {
			y--
			ops = append(ops, diffOp{tag: opInsert, text: b[y]})
		} else if y == prevY {
			x--
			ops = append(ops, diffOp{tag: opDelete, text: a[x]})
		}
	}

	for x > 0 && y > 0 {
		x--
		y--
		ops = append(ops, diffOp{tag: opEqual, text: a[x]})
	}

	for i, j := 0, len(ops)-1; i < j; i, j = i+1, j-1 {
		ops[i], ops[j] = ops[j], ops[i]
	}

	return ops
}

const (
	EditMarkerPrefix = "<<<edit:"
	EditMarkerSuffix = ">>>"
)

func FormatEditMarker(editID string) string {
	return EditMarkerPrefix + editID + EditMarkerSuffix
}

func ParseEditMarker(text string) (string, bool) {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, EditMarkerPrefix) && strings.HasSuffix(text, EditMarkerSuffix) {
		id := strings.TrimSuffix(strings.TrimPrefix(text, EditMarkerPrefix), EditMarkerSuffix)
		if id != "" {
			return id, true
		}
	}
	return "", false
}

func HasUnresolvedEditMarkers(text string) bool {
	return strings.Contains(text, EditMarkerPrefix)
}

func DiffAndMarkBlocks(before, after string, origin api.SnapshotEditType) (string, []api.SnapshotEdit) {
	if before == after {
		return before, []api.SnapshotEdit{}
	}

	now := time.Now().UTC().Format(time.RFC3339)

	if strings.TrimSpace(before) == "" {
		id := security.RandomString(15)
		edit := api.SnapshotEdit{
			ID:           id,
			Sequence:     1,
			Type:         origin,
			Status:       api.EditStatusProposed,
			ContentAfter: after,
			BlockIndex:   0,
			CreatedAt:    now,
		}
		return FormatEditMarker(id), []api.SnapshotEdit{edit}
	}

	if strings.TrimSpace(after) == "" {
		id := security.RandomString(15)
		edit := api.SnapshotEdit{
			ID:            id,
			Sequence:      1,
			Type:          origin,
			Status:        api.EditStatusProposed,
			ContentBefore: before,
			BlockIndex:    0,
			CreatedAt:     now,
		}
		return FormatEditMarker(id), []api.SnapshotEdit{edit}
	}

	blocksA := SegmentMarkdownBlocks(before)
	blocksB := SegmentMarkdownBlocks(after)
	ops := myersDiff(blocksA, blocksB)

	var edits []api.SnapshotEdit
	var draftBlocks []string
	var seq int = 1

	i := 0
	for i < len(ops) {
		op := ops[i]
		if op.tag == opEqual {
			draftBlocks = append(draftBlocks, op.text)
			i++
			continue
		}

		editBlockIndex := len(draftBlocks)
		var delBlocks []string
		var insBlocks []string

		for i < len(ops) && ops[i].tag != opEqual {
			switch ops[i].tag {
			case opDelete:
				delBlocks = append(delBlocks, ops[i].text)
			case opInsert:
				insBlocks = append(insBlocks, ops[i].text)
			}
			i++
		}

		id := security.RandomString(15)
		edits = append(edits, api.SnapshotEdit{
			ID:            id,
			Sequence:      seq,
			Type:          origin,
			Status:        api.EditStatusProposed,
			ContentBefore: strings.Join(delBlocks, "\n\n"),
			ContentAfter:  strings.Join(insBlocks, "\n\n"),
			BlockIndex:    editBlockIndex,
			CreatedAt:     now,
		})
		draftBlocks = append(draftBlocks, FormatEditMarker(id))
		seq++
	}

	return strings.Join(draftBlocks, "\n\n"), edits
}
