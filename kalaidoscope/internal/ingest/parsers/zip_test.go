package parsers

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"
)

func buildTestZip(t *testing.T, entries [][2]any) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, entry := range entries {
		name := entry[0].(string)
		var data []byte
		switch v := entry[1].(type) {
		case string:
			data = []byte(v)
		case []byte:
			data = v
		default:
			t.Fatalf("unsupported test zip payload %T", v)
		}
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %q: %v", name, err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("write zip entry %q: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func TestParseZip_EmlFilesAndFromLineInBody(t *testing.T) {
	eml1 := "From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Hello\r\nDate: Mon, 02 Jan 2026 15:04:05 +0000\r\n\r\nFirst line.\r\nFrom here we went to the park.\r\n"
	eml2 := "From: carol@example.com\r\nSubject: Update\r\n\r\nSecond email body.\r\n"

	archive := buildTestZip(t, [][2]any{
		{"mail/one.eml", eml1},
		{"mail/two.eml", eml2},
		{"__MACOSX/mail/._one.eml", []byte{0x00, 0x05, 0x16, 0x07, 'm', 'a', 'c'}},
		{"mail/.DS_Store", []byte("Bud1")},
		{"mail/._two.eml", []byte("resource fork")},
	})

	var got []Fragment
	err := Parse(context.Background(), Source{Name: "emails.zip", Data: archive}, nil, func(f Fragment) error {
		got = append(got, f)
		return nil
	})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d fragments, want 2: %+v", len(got), got)
	}
	if got[0].Type != "email" || got[0].Source != "alice@example.com · Hello" {
		t.Errorf("fragment[0] = type %q source %q", got[0].Type, got[0].Source)
	}
	if !strings.Contains(got[0].Content, "From here we went to the park.") {
		t.Errorf("fragment[0] content lost line after 'From ': %q", got[0].Content)
	}
	if got[1].Type != "email" || got[1].Source != "carol@example.com · Update" {
		t.Errorf("fragment[1] = type %q source %q", got[1].Type, got[1].Source)
	}
}

func TestParseZip_ContentClassification(t *testing.T) {
	docx := buildTestZip(t, [][2]any{
		{"word/document.xml", `<w:document><w:body><w:p><w:r><w:t>Docx body</w:t></w:r></w:p></w:body></w:document>`},
	})
	nested := buildTestZip(t, [][2]any{
		{"nested.eml", "From: nested@example.com\r\nSubject: Deep\r\n\r\nInside nested zip"},
	})
	outer := buildTestZip(t, [][2]any{
		{"note.txt", "plain note"},
		{"doc.docx", docx},
		{"inner.zip", nested},
		{"image.png", []byte{0x89, 'P', 'N', 'G', 0x00, 0x01, 0x02}},
		{"corrupt.zip", []byte{'P', 'K', 0x03, 0x04, 'b', 'a', 'd'}},
	})

	var got []Fragment
	err := Parse(context.Background(), Source{Name: "bundle.zip", Data: outer}, nil, func(f Fragment) error {
		got = append(got, f)
		return nil
	})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d fragments, want 3 (note, docx, nested eml): %+v", len(got), got)
	}
	if got[0].Type != "note" || got[0].Content != "plain note" {
		t.Errorf("fragment[0] = %+v", got[0])
	}
	if got[1].Type != "note" || got[1].Content != "Docx body" {
		t.Errorf("fragment[1] = %+v", got[1])
	}
	if got[2].Type != "email" || !strings.Contains(got[2].Content, "Inside nested zip") {
		t.Errorf("fragment[2] = %+v", got[2])
	}
}

func TestParseZip_ExplicitExtensionsStillFilters(t *testing.T) {
	archive := buildTestZip(t, [][2]any{
		{"keep.eml", "From: a@example.com\r\nSubject: Keep\r\n\r\nkept"},
		{"skip.txt", "skipped"},
		{"__MACOSX/._keep.eml", "From: junk@example.com\r\n\r\njunk"},
	})

	var got []Fragment
	err := Parse(context.Background(), Source{Name: "emails.zip", Data: archive}, []string{".eml"}, func(f Fragment) error {
		got = append(got, f)
		return nil
	})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(got) != 1 || got[0].Source != "a@example.com · Keep" {
		t.Fatalf("got %+v, want single kept eml", got)
	}
}

func TestParseZip_MaxArchiveDepth(t *testing.T) {
	// Build a zip nested deeper than maxArchiveDepth so the innermost entry is skipped.
	payload := []byte("too deep")
	for i := 0; i <= maxArchiveDepth+1; i++ {
		name := "inner.zip"
		if i == 0 {
			name = "leaf.txt"
		}
		payload = buildTestZip(t, [][2]any{{name, payload}})
	}

	var got []Fragment
	err := Parse(context.Background(), Source{Name: "deep.zip", Data: payload}, nil, func(f Fragment) error {
		got = append(got, f)
		return nil
	})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d fragments beyond max depth, want 0", len(got))
	}
}

func TestLooksLikeText(t *testing.T) {
	// 3-byte UTF-8 rune '€' (0xE2 0x82 0xAC) chopped after 2 bytes at end of sample.
	choppedUTF8 := append([]byte("price "), 0xE2, 0x82)

	cases := []struct {
		name   string
		sample []byte
		want   bool
	}{
		{"empty", nil, true},
		{"ascii", []byte("plain ascii"), true},
		{"utf8", []byte("café résumé — über"), true},
		{"chopped utf8 boundary", choppedUTF8, true},
		{"latin1", []byte{'c', 'a', 'f', 0xE9}, true},
		{"nul byte", []byte{'h', 'i', 0x00, 'x'}, false},
		{"control bytes", []byte{0x01, 0x02, 0x03, 0x04, 0xFF, 0xFE}, false},
	}
	for _, tc := range cases {
		if got := looksLikeText(tc.sample); got != tc.want {
			t.Errorf("looksLikeText(%s) = %v, want %v", tc.name, got, tc.want)
		}
	}
}
