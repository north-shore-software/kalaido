package prompts

import "testing"

func TestParseYesNo(t *testing.T) {
	for reply, want := range map[string]bool{
		"YES": true, " yes.": true, "Yes, it matches": true,
		"NO": false, "No, this is not a YES case": false, "": false, "Maybe yes": false,
	} {
		if got := ParseYesNo(reply); got != want {
			t.Errorf("ParseYesNo(%q) = %v", reply, got)
		}
	}
}
