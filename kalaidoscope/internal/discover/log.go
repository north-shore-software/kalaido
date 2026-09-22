// UNREVIEWED
package discover

import (
	"log/slog"
	"sync"
)

var (
	loggerOnce sync.Once
	pkgLogger  *slog.Logger
)

// logger is the process logger tagged with this package. Resolved on first
// use, after main has installed the process handler, and cached: With
// allocates, and a log call should not.
func logger() *slog.Logger {
	loggerOnce.Do(func() { pkgLogger = slog.Default().With("component", "discover") })
	return pkgLogger
}
