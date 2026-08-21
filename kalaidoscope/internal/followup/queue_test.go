package followup

import (
	"errors"
	"testing"
)

func TestTakeHandsOffOnlyWhatWasPendingAtStart(t *testing.T) {
	var q Queue
	var got []string
	q.Add(func(err error) { got = append(got, "first") })

	active := q.Take()
	q.Add(func(err error) { got = append(got, "second") })
	Run(active, nil)

	if len(got) != 1 || got[0] != "first" {
		t.Fatalf("expected only the first follow-up to run, got %v", got)
	}

	Run(q.Take(), nil)
	if len(got) != 2 || got[1] != "second" {
		t.Fatalf("expected the second follow-up on the next drain, got %v", got)
	}
	if len(q.Take()) != 0 {
		t.Fatal("follow-ups must be one-shot")
	}
}

func TestRunPassesDrainError(t *testing.T) {
	var q Queue
	want := errors.New("boom")
	var got error
	q.Add(func(err error) { got = err })
	Run(q.Take(), want)
	if !errors.Is(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
