package prompts

import "testing"

func TestParseCriticReplyMatch(t *testing.T) {
	r, ok := ParseCriticReply("VERDICT: MATCH")
	if !ok || !r.Match {
		t.Fatalf("want match, got ok=%v r=%+v", ok, r)
	}
	// Tolerate prose around the verdict line.
	r, ok = ParseCriticReply("The output is identical.\nVERDICT: MATCH\n")
	if !ok || !r.Match {
		t.Fatalf("want match with surrounding prose, got ok=%v r=%+v", ok, r)
	}
}

func TestParseCriticReplyMismatch(t *testing.T) {
	reply := "VERDICT: MISMATCH\nSCORE: 40\nDIAGNOSIS: headings are missing,\nand items should be one sentence."
	r, ok := ParseCriticReply(reply)
	if !ok {
		t.Fatal("want ok")
	}
	if r.Match {
		t.Fatal("want mismatch")
	}
	if r.Score != 40 {
		t.Fatalf("score = %d, want 40", r.Score)
	}
	// The diagnosis runs to the end of the message, newlines included.
	if r.Diagnosis != "headings are missing,\nand items should be one sentence." {
		t.Fatalf("diagnosis = %q", r.Diagnosis)
	}
}

func TestParseCriticReplyMalformed(t *testing.T) {
	for _, reply := range []string{
		"",
		"The output looks wrong to me.",        // no verdict
		"VERDICT: MISMATCH\nSCORE: 40",         // mismatch without a diagnosis
		"VERDICT: MISMATCH\nDIAGNOSIS:   \n",   // diagnosis present but empty
		"VERDICT: maybe\nDIAGNOSIS: something", // unknown verdict
	} {
		if _, ok := ParseCriticReply(reply); ok {
			t.Errorf("ParseCriticReply(%q) unexpectedly ok", reply)
		}
	}
}

func TestParseCriticReplyBadScoreIgnored(t *testing.T) {
	r, ok := ParseCriticReply("VERDICT: MISMATCH\nSCORE: not-a-number\nDIAGNOSIS: too long")
	if !ok || r.Score != 0 || r.Diagnosis != "too long" {
		t.Fatalf("got ok=%v r=%+v", ok, r)
	}
}
