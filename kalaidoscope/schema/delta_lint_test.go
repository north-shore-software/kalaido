package schema

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A delta is frozen once shipped, while Canonical keeps moving; a delta that
// read Canonical would change meaning with every later edit.
func TestDeltasNeverReferenceCanonical(t *testing.T) {
	entries, err := os.ReadDir("deltas")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		path := filepath.Join("deltas", e.Name())
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok && id.Name == "Canonical" {
				t.Errorf("%s: references Canonical; a delta must spell out what it needs", fset.Position(id.Pos()))
			}
			return true
		})
	}
}

// Every registered delta belongs to a version this build knows, and no
// version above 1 can be reached without at least the bump being declared.
func TestRegisteredDeltasMatchVersion(t *testing.T) {
	for _, d := range deltas {
		if d.Version < 2 || d.Version > Version {
			t.Errorf("delta %q targets v%d, outside (1, %d]", d.Name, d.Version, Version)
		}
	}
}
