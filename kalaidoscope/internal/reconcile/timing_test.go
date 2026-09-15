package reconcile

import (
	"errors"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

// drainSignal empties the shared wave channel so a test observes only the
// signals it causes.
func drainSignal() {
	for {
		select {
		case <-waveSignal:
		default:
			return
		}
	}
}

func resetTimers() {
	timerMu.Lock()
	defer timerMu.Unlock()
	if debounce != nil {
		debounce.Stop()
		debounce = nil
	}
	if retryTimer != nil {
		retryTimer.Stop()
		retryTimer = nil
	}
	retries = 0
}

func signalled(t *testing.T, within time.Duration) bool {
	t.Helper()
	select {
	case <-waveSignal:
		return true
	case <-time.After(within):
		return false
	}
}

// A burst of triggers — an import completing, the colour worker draining, the
// map settling — starts one wave, not one per trigger.
func TestEnqueueWaveCoalescesBursts(t *testing.T) {
	drainSignal()
	resetTimers()
	old, oldAuto := waveDebounce, autoWave
	waveDebounce, autoWave = 10*time.Millisecond, true
	t.Cleanup(func() { waveDebounce, autoWave = old, oldAuto; resetTimers() })

	for range 5 {
		EnqueueWave()
		time.Sleep(2 * time.Millisecond)
	}
	if !signalled(t, 200*time.Millisecond) {
		t.Fatal("no wave signalled after the debounce")
	}
	if signalled(t, 50*time.Millisecond) {
		t.Error("a second wave was signalled for the same burst")
	}
}

// Without KALAIDO_AUTO_WAVE the automatic triggers are inert: only Start
// begins a wave, and it does so at once.
func TestWaveIsOptInAndStartIsImmediate(t *testing.T) {
	drainSignal()
	resetTimers()
	old, oldAuto := waveDebounce, autoWave
	waveDebounce, autoWave = 10*time.Millisecond, false
	t.Cleanup(func() { waveDebounce, autoWave = old, oldAuto; resetTimers() })

	if WaveEnabled() {
		t.Fatal("WaveEnabled should report the policy as off")
	}
	EnqueueWave()
	if signalled(t, 50*time.Millisecond) {
		t.Fatal("an automatic trigger started a wave with auto off")
	}

	StartWave()
	if !signalled(t, 5*time.Millisecond) {
		t.Fatal("Start did not signal a wave immediately")
	}
}

// Start absorbs an automatic request still waiting on its debounce: one wave,
// now, not one now and another when the timer fires.
func TestStartWaveCancelsPendingDebounce(t *testing.T) {
	drainSignal()
	resetTimers()
	old, oldAuto := waveDebounce, autoWave
	waveDebounce, autoWave = 20*time.Millisecond, true
	t.Cleanup(func() { waveDebounce, autoWave = old, oldAuto; resetTimers() })

	EnqueueWave()
	StartWave()
	if !signalled(t, 5*time.Millisecond) {
		t.Fatal("Start did not signal a wave immediately")
	}
	if signalled(t, 60*time.Millisecond) {
		t.Error("the cancelled debounce still fired a second wave")
	}
}

// A transient failure schedules its own follow-up so the chain does not sit
// half-generated until the next real trigger.
func TestAfterWaveRetriesTransientError(t *testing.T) {
	drainSignal()
	resetTimers()
	old := retryBackoff
	retryBackoff = []time.Duration{5 * time.Millisecond}
	t.Cleanup(func() { retryBackoff = old; resetTimers() })

	afterWave(errors.New("boom"))
	if got := LastError(); got != "boom" {
		t.Errorf("LastError = %q, want boom", got)
	}
	if !signalled(t, 200*time.Millisecond) {
		t.Fatal("no retry wave signalled")
	}

	afterWave(nil)
	if got := LastError(); got != "" {
		t.Errorf("LastError after a clean wave = %q, want empty", got)
	}
	if LastCompleted().IsZero() {
		t.Error("LastCompleted not recorded after a clean wave")
	}
	if signalled(t, 30*time.Millisecond) {
		t.Error("a clean wave must not schedule a retry")
	}
}

// Quota exhaustion is not something a retry can fix; the next real trigger
// re-enters.
func TestAfterWaveDoesNotRetryExhaustedQuota(t *testing.T) {
	drainSignal()
	resetTimers()
	old := retryBackoff
	retryBackoff = []time.Duration{5 * time.Millisecond}
	t.Cleanup(func() { retryBackoff = old; resetTimers() })

	afterWave(usage.ErrExhausted)
	if signalled(t, 50*time.Millisecond) {
		t.Error("a retry was scheduled after quota exhaustion")
	}
	if got := LastError(); got == "" {
		t.Error("LastError empty after an exhausted wave")
	}
}
