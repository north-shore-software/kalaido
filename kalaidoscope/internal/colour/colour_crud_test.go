package colour_test

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestColourDomainCRUD(t *testing.T) {
	app := testutil.NewApp(t)

	// 1. Create
	c, err := colour.Create(app, colour.CreateParams{
		Name:   "Blue Swatch",
		Prompt: "all things blue",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if c.GetString("name") != "Blue Swatch" {
		t.Errorf("name = %q, want 'Blue Swatch'", c.GetString("name"))
	}
	if c.GetString("prompt") != "all things blue" {
		t.Errorf("prompt = %q, want 'all things blue'", c.GetString("prompt"))
	}

	// 2. Update
	newName := "Navy Blue"
	newPrompt := "navy and dark blue"
	updated, promptChanged, err := colour.Update(app, c.Id, colour.UpdateParams{
		Name:   &newName,
		Prompt: &newPrompt,
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if !promptChanged {
		t.Error("promptChanged should be true")
	}
	if updated.GetString("name") != "Navy Blue" {
		t.Errorf("name = %q, want 'Navy Blue'", updated.GetString("name"))
	}

	// 3. Delete
	if err := colour.Delete(app, c.Id); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Check it is actually deleted from db
	_, err = app.FindRecordById(schema.ColColour.String(), c.Id)
	if err == nil {
		t.Error("record should not exist after Delete")
	}
}
