package schema

import (
	"errors"
	"fmt"
	"os"

	"github.com/pocketbase/pocketbase/core"
)

// Options tunes the runner for a binary flavour.
type Options struct {
	// BeforeRestore runs after every PocketBase connection is closed and
	// before the pre-migration backup is copied over data.db. The cloud
	// binary closes Litestream here so the file is never replaced under a
	// live replica.
	BeforeRestore func()
}

type mode int

const (
	modeNormal  mode = iota
	modeInspect      // report, never bootstrap or upgrade (schema status)
	modeRetry        // clear a failed marker first (schema retry)
)

// Status is what the runner learned about the database it opened.
type Status struct {
	// Version the database is at; 0 for a database not yet created.
	Version int `json:"version"`
	// Latest is this binary's Version.
	Latest int `json:"latest"`
	// Failed is the standing failed-upgrade marker, if any.
	Failed  *Failure     `json:"failed"`
	History []HistoryRow `json:"history"`
}

// Install binds the lifecycle to the app's bootstrap. It runs after
// PocketBase's own bootstrap (data files open, system migrations applied,
// collections cached) and before any command or serve hook.
func Install(app core.App, opts Options) {
	m := modeFromArgs(os.Args)
	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return run(e.App, opts, m)
	})
}

// Upgrade brings an already-bootstrapped database to Version: what Install
// does at boot, exposed for tests that build a database another way.
func Upgrade(app core.App, opts Options) error {
	return run(app, opts, modeNormal)
}

// BootstrapFrom creates a version-1 database from a frozen baseline instead
// of Canonical: the "old database" half of a parity test.
func BootstrapFrom(app core.App, apply func(core.App) error) error {
	if err := apply(app); err != nil {
		return err
	}
	if err := ensureStateTable(app); err != nil {
		return err
	}
	return stamp(app, 1, sourceBootstrap)
}

// lastStatus is what the runner saw at boot, for the schema command.
var lastStatus Status

// latestVersion is Version, as a variable so tests can stage an upgrade.
var latestVersion = Version

// CurrentStatus reads the database's version state. Safe to call from a
// request handler.
func CurrentStatus(app core.App) (Status, error) {
	st := Status{Latest: latestVersion}
	exists, err := stateTableExists(app)
	if err != nil {
		return st, err
	}
	if exists {
		if st.Version, err = currentVersion(app); err != nil {
			return st, err
		}
		if st.History, err = history(app); err != nil {
			return st, err
		}
	}
	st.Failed, err = readFailure(app.DataDir())
	return st, err
}

func run(app core.App, opts Options, m mode) error {
	dataDir := app.DataDir()

	if m == modeRetry {
		if err := clearFailure(dataDir); err != nil {
			return err
		}
	}
	failed, err := readFailure(dataDir)
	if err != nil {
		return err
	}

	exists, err := stateTableExists(app)
	if err != nil {
		return err
	}
	if !exists {
		if _, err := app.FindCollectionByNameOrId("fragment"); err == nil {
			return errors.New("schema: this database predates schema versioning and cannot be upgraded; delete it and start again")
		}
		if m == modeInspect {
			return record(app)
		}
		if err := applyCanonical(app); err != nil {
			return fmt.Errorf("schema: create v%d: %w", latestVersion, err)
		}
		if err := ensureStateTable(app); err != nil {
			return err
		}
		if err := stamp(app, latestVersion, sourceBootstrap); err != nil {
			return err
		}
		return record(app)
	}

	current, err := currentVersion(app)
	if err != nil {
		return err
	}

	if current > latestVersion {
		fmt.Printf("KALAIDO_SCHEMA_NEWER={\"version\":%d,\"latest\":%d}\n", current, latestVersion)
		return fmt.Errorf("schema: this database is at v%d but this build supports up to v%d; update Kalaido", current, latestVersion)
	}

	if m == modeInspect || current == latestVersion {
		return record(app)
	}

	if failed != nil {
		if failed.BinaryRev != "" && failed.BinaryRev == buildRev() {
			report(failed)
			return fmt.Errorf("%w: the previous attempt by this build failed (v%d -> v%d, %s); not retrying", ErrMigrationFailed, failed.From, failed.To, failed.Delta)
		}
		if err := clearFailure(dataDir); err != nil {
			return err
		}
	}

	return upgrade(app, opts, current)
}

func record(app core.App) error {
	st, err := CurrentStatus(app)
	if err != nil {
		return err
	}
	lastStatus = st
	return nil
}

func upgrade(app core.App, opts Options, from int) error {
	backup, err := createBackup(app, from)
	if err != nil {
		return err
	}
	for v := from + 1; v <= latestVersion; v++ {
		for _, d := range deltasFor(v) {
			if err := d.Up(app); err != nil {
				return fail(app, opts, from, v, d.Name, err, backup)
			}
		}
		if err := stamp(app, v, sourceDelta); err != nil {
			return fail(app, opts, from, v, "stamp", err, backup)
		}
	}
	return record(app)
}

// fail unwinds a failed upgrade: close everything, put the backup back,
// leave the marker, tell the world, and return an error that ends the boot.
func fail(app core.App, opts Options, from, to int, delta string, cause error, backup string) error {
	dataDir := app.DataDir()
	f := &Failure{
		From:      from,
		To:        to,
		Delta:     delta,
		Error:     cause.Error(),
		Backup:    backup,
		At:        nowUTC(),
		BinaryRev: buildRev(),
	}

	if err := app.ResetBootstrapState(); err != nil {
		f.Error += "; closing database: " + err.Error()
	}
	if opts.BeforeRestore != nil {
		opts.BeforeRestore()
	}
	if err := restoreBackup(dataDir, backup); err != nil {
		f.Error += "; restore: " + err.Error()
	} else {
		f.Restored = true
	}
	if err := writeFailure(dataDir, f); err != nil {
		f.Error += "; writing marker: " + err.Error()
	}
	report(f)
	return fmt.Errorf("%w: v%d -> v%d in %s: %v", ErrMigrationFailed, from, to, delta, cause)
}
