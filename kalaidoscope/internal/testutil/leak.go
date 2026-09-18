package testutil

import (
	"testing"

	"go.uber.org/goleak"
)

// LeakOptions returns the default goleak options for tests that spin up
// PocketBase and HTTP test servers.
func LeakOptions() []goleak.Option {
	return []goleak.Option{
		// database/sql connection pool goroutines created by Go's sql package
		// when PocketBase opens SQLite.
		goleak.IgnoreTopFunction("database/sql.(*DB).connectionOpener"),
		goleak.IgnoreTopFunction("database/sql.(*DB).connectionCleaner"),
		// PocketBase internal background logger batch writer.
		goleak.IgnoreTopFunction("github.com/pocketbase/pocketbase/core.(*BaseApp).initLogger.func3"),
	}
}

// VerifyNoLeaks asserts that no unexpected goroutines are running at the end of t.
func VerifyNoLeaks(t *testing.T, extraOpts ...goleak.Option) {
	t.Helper()
	opts := append(LeakOptions(), extraOpts...)
	goleak.VerifyNone(t, opts...)
}
