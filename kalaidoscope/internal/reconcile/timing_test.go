package reconcile

import (
	"errors"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

// timingWorker is a worker that is never run: its signal channel is the
// observation point. Each test owns one, so the tests are independent and
// can run in parallel.
func timingWorker(t *testing.T, auto bool, debounce time.Duration) *Worker {
	t.Helper()
	w := NewWorker(nil, Options{AutoWave: auto, Debounce: debounce})
	t.Cleanup(w.stopTimers)
	return w
}

func signalled(t *testing.T, w *Worker, within time.Duration) bool {
	t.Helper()
	select {
	case <-w.signal.C():
		return true
	case <-time.After(within):
		return false
	}
}

// A burst of triggers — an import completing, the colour worker draining, the
// map settling — starts one wave, not one per trigger.
func TestEnqueueWaveCoalescesBursts(t *testing.T) {
	t.Parallel()
	w := timingWorker(t, true, 10*time.Millisecond)

	for range 5 {
		w.EnqueueWave()
		time.Sleep(2 * time.Millisecond)
	}
	if !signalled(t, w, 200*time.Millisecond) {
		t.Fatal("no wave signalled after the debounce")
	}
	if signalled(t, w, 50*time.Millisecond) {
		t.Error("a second wave was signalled for the same burst")
	}
}

// Without KALAIDO_AUTO_WAVE the automatic triggers are inert: only Start
// begins a wave, and it does so at once.
func TestWaveIsOptInAndStartIsImmediate(t *testing.T) {
	t.Parallel()
	w := timingWorker(t, false, 10*time.Millisecond)

	if w.WaveEnabled() {
		t.Fatal("WaveEnabled should report the policy as off")
	}
	w.EnqueueWave()
	if signalled(t, w, 50*time.Millisecond) {
		t.Fatal("an automatic trigger started a wave with auto off")
	}

	w.StartWave()
	if !signalled(t, w, 5*time.Millisecond) {
		t.Fatal("Start did not signal a wave immediately")
	}
}

// Start absorbs an automatic request still waiting on its debounce: one wave,
// now, not one now and another when the timer fires.
func TestStartWaveCancelsPendingDebounce(t *testing.T) {
	t.Parallel()
	w := timingWorker(t, true, 20*time.Millisecond)

	w.EnqueueWave()
	w.StartWave()
	if !signalled(t, w, 5*time.Millisecond) {
		t.Fatal("Start did not signal a wave immediately")
	}
	if signalled(t, w, 60*time.Millisecond) {
		t.Error("the cancelled debounce still fired a second wave")
	}
}

// A transient failure schedules its own follow-up so the chain does not sit
// half-generated until the next real trigger.
func TestAfterWaveRetriesTransientError(t *testing.T) {
	t.Parallel()
	w := timingWorker(t, true, time.Second)
	w.retryBackoff = []time.Duration{5 * time.Millisecond}

	w.afterWave(errors.New("boom"))
	if got := w.Status().LastError; got != "boom" {
		t.Errorf("LastError = %q, want boom", got)
	}
	if !signalled(t, w, 200*time.Millisecond) {
		t.Fatal("no retry wave signalled")
	}

	w.afterWave(nil)
	if got := w.Status().LastError; got != "" {
		t.Errorf("LastError after a clean wave = %q, want empty", got)
	}
	if w.Status().LastCompleted.IsZero() {
		t.Error("LastCompleted not recorded after a clean wave")
	}
	if signalled(t, w, 30*time.Millisecond) {
		t.Error("a clean wave must not schedule a retry")
	}
}

// Quota exhaustion is not something a retry can fix; the next real trigger
// re-enters.
func TestAfterWaveDoesNotRetryExhaustedQuota(t *testing.T) {
	t.Parallel()
	w := timingWorker(t, true, time.Second)
	w.retryBackoff = []time.Duration{5 * time.Millisecond}

	w.afterWave(usage.ErrExhausted)
	if signalled(t, w, 50*time.Millisecond) {
		t.Error("a retry was scheduled after quota exhaustion")
	}
	if got := w.Status().LastError; got == "" {
		t.Error("LastError empty after an exhausted wave")
	}
}
