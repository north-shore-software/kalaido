package prompts

import "testing"

func TestParseLoopReplyMatch(t *testing.T) {
	r, ok := ParseLoopReply("VERDICT: MATCH")
	if !ok || !r.Match {
		t.Fatalf("want match, got ok=%v r=%+v", ok, r)
	}
	// Tolerate prose around the verdict line.
	r, ok = ParseLoopReply("The output is identical.\nVERDICT: MATCH\n")
	if !ok || !r.Match {
		t.Fatalf("want match with surrounding prose, got ok=%v r=%+v", ok, r)
	}
}

func TestParseLoopReplyMismatch(t *testing.T) {
	reply := "VERDICT: MISMATCH\nSCORE: 40\nDIAGNOSIS: headings are missing\nREVISED LENS:\nWrite a summary.\nUse headings."
	r, ok := ParseLoopReply(reply)
	if !ok {
		t.Fatal("want ok")
	}
	if r.Match {
		t.Fatal("want mismatch")
	}
	if r.Score != 40 {
		t.Fatalf("score = %d, want 40", r.Score)
	}
	if r.Diagnosis != "headings are missing" {
		t.Fatalf("diagnosis = %q", r.Diagnosis)
	}
	if r.Lens != "Write a summary.\nUse headings." {
		t.Fatalf("lens = %q", r.Lens)
	}
}

func TestParseLoopReplyMalformed(t *testing.T) {
	for _, reply := range []string{
		"",
		"Here is a new lens:\nWrite a summary.", // no verdict
		"VERDICT: MISMATCH\nSCORE: 40",          // mismatch without a revised lens
		"VERDICT: MISMATCH\nREVISED LENS:\n   \n",  // revision present but empty
		"VERDICT: maybe\nREVISED LENS:\nsomething", // unknown verdict
	} {
		if _, ok := ParseLoopReply(reply); ok {
			t.Errorf("ParseLoopReply(%q) unexpectedly ok", reply)
		}
	}
}

func TestParseLoopReplyBadScoreIgnored(t *testing.T) {
	r, ok := ParseLoopReply("VERDICT: MISMATCH\nSCORE: not-a-number\nREVISED LENS:\nnew lens")
	if !ok || r.Score != 0 || r.Lens != "new lens" {
		t.Fatalf("got ok=%v r=%+v", ok, r)
	}
}
