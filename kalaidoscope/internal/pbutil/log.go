package pbutil

import "log/slog"

// logger is the process logger tagged with this package.
func logger() *slog.Logger { return slog.Default().With("component", "pbutil") }
