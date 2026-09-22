// UNREVIEWED
package workerutil

import (
	"errors"
	"testing"
)

func TestCallbacksDetachHandsOffOnlyWhatWasPendingAtStart(t *testing.T) {
	var c Callbacks
	var got []string
	c.Add(func(err error) { got = append(got, "first") })

	active := c.Detach()
	c.Add(func(err error) { got = append(got, "second") })
	active.Invoke(nil)

	if len(got) != 1 || got[0] != "first" {
		t.Fatalf("expected only the first callback to run, got %v", got)
	}

	second := c.Detach()
	second.Invoke(nil)
	if len(got) != 2 || got[1] != "second" {
		t.Fatalf("expected the second callback on the next pass, got %v", got)
	}
	if len(c.Detach()) != 0 {
		t.Fatal("callbacks must be one-shot")
	}
}

func TestCallbackBatchInvokePassesDrainError(t *testing.T) {
	var c Callbacks
	want := errors.New("boom")
	var got error
	c.Add(func(err error) { got = err })
	c.Detach().Invoke(want)
	if !errors.Is(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
