package mapping

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/followup"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	threshold             = 10
	estAnnotationBytes    = 1 << 10
	maxExpansionsPerChunk = 8
	maxToolRounds         = 4
	markupConcurrency     = 100
	maxThrottledAttempts  = 6

	bytesPerToken = 4 // rough English-text estimate
)

// mapBudgets derives the map-body and chunk byte budgets from a provider's
// context window: half the window is reserved for prompt scaffolding and the
// reply (incorporate's reply is the full updated map body), split 1:3 between
// the map body and the new-material chunk.
func mapBudgets(ctxWindowTokens int) (mapBudgetBytes, chunkBudgetBytes int) {
	usable := ctxWindowTokens * bytesPerToken / 2
	mapBudgetBytes = usable / 4
	chunkBudgetBytes = usable - mapBudgetBytes
	return
}

// autoMapEnabled gates the automatic map triggers: ingest completion, the
// fragment-create backlog check, and the boot-time backlog sweep. Temporarily
// disabled; the manual kick (POST /api/map -> Signal) and the explicit
// organize-after pipeline stay live.
const autoMapEnabled = false

var signal = make(chan struct{}, 1)

var followUps followup.Queue

var workerApp core.App

func Register(app core.App) {
	workerApp = app
	go loop()
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := se.Next(); err != nil {
			return err
		}
		if n, err := pendingCount(app); err == nil && n > 0 {
			SignalAuto()
		}
		return nil
	})
}

func Signal() {
	select {
	case signal <- struct{}{}:
	default:
	}
}

// SignalAuto is the entry point for automatic triggers; unlike Signal it
// honours the autoMapEnabled gate.
func SignalAuto() {
	if !autoMapEnabled {
		return
	}
	Signal()
}

func AfterDrain(fn func(err error)) {
	followUps.Add(fn)
}

func SignalIfBacklog(app core.App) {
	if !autoMapEnabled {
		return
	}
	if batchIngestActive(app) {
		return
	}
	n, err := pendingCount(app)
	if err != nil {
		log.Printf("mapping: pending count: %v", err)
		return
	}
	if n >= threshold {
		Signal()
	}
}

func batchIngestActive(app core.App) bool {
	recs, err := app.FindRecordsByFilter("ingest", "status = 'pending'", "", 1, 0, nil)
	return err == nil && len(recs) > 0
}

func loop() {
	for range signal {
		active := followUps.Take()
		err := drain(workerApp)
		if err != nil {
			log.Printf("mapping: drain: %v", err)
		}
		followup.Run(active, err)
	}
}

func annotatedIDs(app core.App) (map[string]bool, error) {
	recs, err := app.FindRecordsByFilter("fragment_annotation", "1=1", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(recs))
	for _, r := range recs {
		ids[r.GetString("fragment_id")] = true
	}
	return ids, nil
}

func pendingFragments(app core.App) ([]*core.Record, error) {
	done, err := annotatedIDs(app)
	if err != nil {
		return nil, err
	}
	recs, err := app.FindRecordsByFilter("fragment", "deleted_at = ''", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	var pending []*core.Record
	for _, r := range recs {
		if !done[r.Id] {
			pending = append(pending, r)
		}
	}
	sort.SliceStable(pending, func(i, j int) bool {
		return pending[i].GetDateTime("source_time").Compare(pending[j].GetDateTime("source_time")) < 0
	})
	return pending, nil
}

func pendingCount(app core.App) (int, error) {
	pending, err := pendingFragments(app)
	if err != nil {
		return 0, err
	}
	return len(pending), nil
}

func buildChunks(frags []*core.Record, firstIsRaw bool, budget int) [][]*core.Record {
	var chunks [][]*core.Record
	var cur []*core.Record
	size := 0
	sizeOf := func(r *core.Record) int { return min(len(r.GetString("content")), estAnnotationBytes) }
	if firstIsRaw {
		sizeOf = func(r *core.Record) int { return len(r.GetString("content")) }
	}
	for _, f := range frags {
		s := sizeOf(f)
		if len(cur) > 0 && size+s > budget {
			chunks = append(chunks, cur)
			cur, size = nil, 0
			if firstIsRaw {
				firstIsRaw = false
				sizeOf = func(r *core.Record) int { return min(len(r.GetString("content")), estAnnotationBytes) }
				s = sizeOf(f)
			}
		}
		cur = append(cur, f)
		size += s
	}
	if len(cur) > 0 {
		chunks = append(chunks, cur)
	}
	return chunks
}

func drain(app core.App) error {
	frags, err := pendingFragments(app)
	if err != nil {
		return err
	}
	if len(frags) == 0 {
		return nil
	}

	m, err := loadMap(app)
	if err != nil {
		return err
	}

	mapModel, err := llm.ResolveRole(llm.RoleMap)
	if err != nil {
		return err
	}
	mapBudgetBytes, chunkBudgetBytes := mapBudgets(llm.SelectedProvider(mapModel).ContextWindow())
	annotateModel, err := llm.ResolveRole(llm.RoleAnnotate)
	if err != nil {
		return err
	}

	runCol, err := app.FindCollectionByNameOrId("map_run")
	if err != nil {
		return err
	}
	run := core.NewRecord(runCol)
	run.Set("status", "running")
	run.Set("fragments_total", len(frags))
	run.Set("map_version_start", m.version)
	if err := app.Save(run); err != nil {
		return err
	}

	ctx := context.Background()
	chunks := buildChunks(frags, m.version == 0, chunkBudgetBytes)
	processed, expansions := 0, 0

	for i, chunk := range chunks {
		var exp int
		var err error
		if m.version == 0 {
			exp, err = incorporateRawThenAnnotate(ctx, app, m, run.Id, mapModel, annotateModel, chunk, mapBudgetBytes)
		} else {
			exp, err = markupAndIncorporate(ctx, app, m, run.Id, mapModel, annotateModel, chunk, mapBudgetBytes)
		}
		if err != nil {
			run.Set("status", "error")
			run.Set("error", fmt.Sprintf("chunk %d/%d: %v", i+1, len(chunks), err))
			run.Set("fragments_processed", processed)
			run.Set("chunks", i)
			run.Set("expansions", expansions)
			run.Set("map_version_end", m.version)
			if serr := app.Save(run); serr != nil {
				log.Printf("mapping: save run: %v", serr)
			}
			return fmt.Errorf("drain aborted at chunk %d/%d: %w", i+1, len(chunks), err)
		}
		processed += len(chunk)
		expansions += exp
		run.Set("fragments_processed", processed)
		run.Set("chunks", i+1)
		run.Set("expansions", expansions)
		if err := app.Save(run); err != nil {
			log.Printf("mapping: save run: %v", err)
		}
	}

	run.Set("status", "done")
	run.Set("map_version_end", m.version)
	if err := app.Save(run); err != nil {
		log.Printf("mapping: save run: %v", err)
	}
	return nil
}

func retryPreempted(f func() error) error {
	throttled := 0
	for {
		err := f()
		if errors.Is(err, llmq.ErrPreempted) {
			continue
		}
		var perr *llm.ProviderError
		if errors.As(err, &perr) && (perr.Kind == llm.ErrKindQuota || perr.Kind == llm.ErrKindTransient) {
			throttled++
			if throttled <= maxThrottledAttempts {
				continue
			}
		}
		return err
	}
}
