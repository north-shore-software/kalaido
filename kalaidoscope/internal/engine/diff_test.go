package engine

import (
	_ "embed"
	"encoding/json"
	"reflect"
	"testing"
)

//go:embed testdata/markdown_segmentation.json
var sharedFixtureData []byte

type sharedFixture struct {
	SegmentationCases []struct {
		Name           string   `json:"name"`
		Markdown       string   `json:"markdown"`
		ExpectedBlocks []string `json:"expectedBlocks"`
	} `json:"segmentationCases"`
	MarkerCases []struct {
		ID        string `json:"id"`
		Formatted string `json:"formatted"`
		Valid     bool   `json:"valid"`
	} `json:"markerCases"`
}

func TestSegmentMarkdownBlocks_SharedFixture(t *testing.T) {
	var f sharedFixture
	if err := json.Unmarshal(sharedFixtureData, &f); err != nil {
		t.Fatalf("failed to unmarshal shared fixture: %v", err)
	}

	for _, c := range f.SegmentationCases {
		t.Run(c.Name, func(t *testing.T) {
			got := SegmentMarkdownBlocks(c.Markdown)
			if len(got) == 0 && len(c.ExpectedBlocks) == 0 {
				return
			}
			if !reflect.DeepEqual(got, c.ExpectedBlocks) {
				t.Errorf("got %v, want %v", got, c.ExpectedBlocks)
			}
		})
	}
}

func TestEditMarkers_SharedFixture(t *testing.T) {
	var f sharedFixture
	if err := json.Unmarshal(sharedFixtureData, &f); err != nil {
		t.Fatalf("failed to unmarshal shared fixture: %v", err)
	}

	for _, c := range f.MarkerCases {
		t.Run(c.ID, func(t *testing.T) {
			formatted := FormatEditMarker(c.ID)
			if formatted != "<<<edit:"+c.ID+">>>" {
				t.Errorf("format mismatch: got %q", formatted)
			}
			id, ok := ParseEditMarker(c.Formatted)
			if ok != c.Valid {
				t.Errorf("parse validity mismatch: got %v, want %v", ok, c.Valid)
			}
			if c.Valid && id != c.ID {
				t.Errorf("parse ID mismatch: got %q, want %q", id, c.ID)
			}
		})
	}
}
