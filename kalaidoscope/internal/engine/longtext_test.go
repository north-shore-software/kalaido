package engine

import (
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// PocketBase caps a TextField at 5000 characters unless the schema says
// otherwise; a generated document and a drafted lens routinely exceed that.
func TestLongTextFieldsAcceptDocuments(t *testing.T) {
	app := testutil.NewApp(t)
	long := strings.Repeat("x", 20_000)
	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": long})
	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "p"})
	testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": proj.Id, "lens_id": lens.Id, "status": StatusApproved, "output": long,
	})
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{"name": "r"})
	testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
		"reflection_id": refl.Id, "lens_id": lens.Id, "status": StatusApproved, "output": long,
	})
}
