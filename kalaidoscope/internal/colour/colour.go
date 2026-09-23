package colour

import (
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

var (
	ErrNotFound     = errors.New("colour not found")
	ErrNameRequired = errors.New("name is required")
)

// CreateParams defines input fields for creating a colour.
type CreateParams struct {
	Name             string
	Prompt           string
	FragmentIDs      []string
	PositiveExamples []string
	NegativeExamples []string
}

// Create creates a new colour, assigns the next swatch, seeds prompt matches,
// and records manual examples.
func Create(app core.App, params CreateParams) (*core.Record, error) {
	name := strings.TrimSpace(params.Name)
	if name == "" {
		return nil, ErrNameRequired
	}

	collection, err := app.FindCollectionByNameOrId(schema.ColColour.String())
	if err != nil {
		return nil, err
	}
	swatch, err := NextSwatch(app)
	if err != nil {
		return nil, err
	}

	colourRec := core.NewRecord(collection)
	colourRec.Set("name", name)
	colourRec.Set("prompt", strings.TrimSpace(params.Prompt))
	colourRec.Set("swatch", swatch)

	if err := app.Save(colourRec); err != nil {
		return nil, err
	}

	for _, fragID := range params.FragmentIDs {
		if err := SetPromptMatch(app, colourRec.Id, fragID); err != nil {
			logger().Warn("colour create: seeding prompt match failed", "fragment_id", fragID, "error", err)
		}
	}

	if err := ApplyExamples(app, colourRec.Id, params.PositiveExamples, params.NegativeExamples, nil); err != nil {
		return nil, err
	}

	return colourRec, nil
}

// UpdateParams defines fields that can be updated on a colour.
type UpdateParams struct {
	Name             *string
	Prompt           *string
	PositiveExamples []string
	NegativeExamples []string
	ClearExamples    []string
}

// Update applies examples and updates fields on an existing colour.
// Reports whether the prompt changed, so callers can trigger rematching if necessary.
func Update(app core.App, id string, params UpdateParams) (*core.Record, bool, error) {
	colourRec, err := app.FindRecordById(schema.ColColour.String(), id)
	if err != nil {
		return nil, false, ErrNotFound
	}

	if err := ApplyExamples(app, colourRec.Id, params.PositiveExamples, params.NegativeExamples, params.ClearExamples); err != nil {
		return nil, false, err
	}

	if params.Name != nil && strings.TrimSpace(*params.Name) != "" {
		colourRec.Set("name", strings.TrimSpace(*params.Name))
	}

	promptChanged := false
	if params.Prompt != nil {
		next := strings.TrimSpace(*params.Prompt)
		promptChanged = next != colourRec.GetString("prompt")
		colourRec.Set("prompt", next)
	}

	if err := app.Save(colourRec); err != nil {
		return nil, false, err
	}

	return colourRec, promptChanged, nil
}

// scrubSpec drops a colour from a context spec (engine.ScrubContextSpecs).
func scrubSpec(spec *api.ContextSpec, id string) {
	spec.ColourIDs = engine.RemoveID(spec.ColourIDs, id)
}

// Delete removes the colour and drops its id from every live context spec so no
// projection or reflection keeps a dangling reference.
func Delete(app core.App, id string) error {
	colourRec, err := app.FindRecordById(schema.ColColour.String(), id)
	if err != nil {
		return ErrNotFound
	}

	return app.RunInTransaction(func(tx core.App) error {
		if err := engine.ScrubContextSpecs(tx, colourRec.Id, scrubSpec); err != nil {
			return err
		}
		return tx.Delete(colourRec)
	})
}

// ApplyExamples writes manual rows. Negatives first, then positives, so a
// fragment named in both ends up pinned; clears run last and re-derive the
// pair mechanically.
func ApplyExamples(app core.App, colourID string, positive, negative, clear []string) error {
	for _, fragID := range negative {
		if err := SetManual(app, colourID, fragID, MatchManualNegative); err != nil {
			return err
		}
	}
	for _, fragID := range positive {
		if err := SetManual(app, colourID, fragID, MatchManualPositive); err != nil {
			return err
		}
	}
	for _, fragID := range clear {
		if err := ClearManual(app, colourID, fragID); err != nil {
			return err
		}
	}
	return nil
}
