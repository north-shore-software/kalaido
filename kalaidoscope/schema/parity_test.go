package schema_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/pocketbase/pocketbase"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema/baseline"
	_ "github.com/north-shore-software/kalaido/kalaidoscope/schema/deltas"
)

func newApp(t *testing.T) *pocketbase.PocketBase {
	t.Helper()
	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir:  t.TempDir(),
		HideStartBanner: true,
	})
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	return app
}

// A database created by the launch build and upgraded through every delta
// must be indistinguishable from one created by this build from Canonical.
// This is the contract that lets Canonical be edited freely: the delta for
// each bump has to reproduce the edit exactly.
func TestFreshMatchesMigrated(t *testing.T) {
	fresh := newApp(t)
	schema.Install(fresh, schema.Options{})
	if err := fresh.Bootstrap(); err != nil {
		t.Fatalf("fresh bootstrap: %v", err)
	}
	freshSnap, err := schema.Snapshot(fresh)
	if err != nil {
		t.Fatal(err)
	}

	old := newApp(t)
	if err := old.Bootstrap(); err != nil {
		t.Fatalf("old bootstrap: %v", err)
	}
	if err := schema.BootstrapFrom(old, baseline.Apply); err != nil {
		t.Fatalf("apply baseline v1: %v", err)
	}
	if err := schema.Upgrade(old, schema.Options{}); err != nil {
		t.Fatalf("upgrade from v1: %v", err)
	}
	oldSnap, err := schema.Snapshot(old)
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(freshSnap, oldSnap) {
		a, _ := json.MarshalIndent(freshSnap, "", "  ")
		b, _ := json.MarshalIndent(oldSnap, "", "  ")
		t.Fatalf("fresh (Canonical) and migrated (baseline v1 + deltas) schemas differ.\n\nfresh:\n%s\n\nmigrated:\n%s", a, b)
	}

	for name, app := range map[string]*pocketbase.PocketBase{"fresh": fresh, "migrated": old} {
		st, err := schema.CurrentStatus(app)
		if err != nil {
			t.Fatal(err)
		}
		if st.Version != schema.Version {
			t.Errorf("%s: at v%d, want v%d", name, st.Version, schema.Version)
		}
		if st.Failed != nil {
			t.Errorf("%s: unexpected failed marker %+v", name, st.Failed)
		}
	}
}
