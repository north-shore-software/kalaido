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

// VerifyNoLeaks asserts that no unexpected goroutines are running at the end
// of t. The check is process-wide: it sees every goroutine, not only those t
// started. That is safe while no test that boots an app calls t.Parallel()
// (Go holds parallel tests until the serial ones finish), and it catches a
// goroutine that outlives its app but not a pending timer, which has no
// goroutine until it fires. A parallel test that needs an app must snapshot
// first with goleak.IgnoreCurrent() and accept the weaker check.
func VerifyNoLeaks(t *testing.T, extraOpts ...goleak.Option) {
	t.Helper()
	opts := append(LeakOptions(), extraOpts...)
	goleak.VerifyNone(t, opts...)
}
