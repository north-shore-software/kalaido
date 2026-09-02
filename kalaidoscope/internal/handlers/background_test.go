package handlers

import "github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"

// Handler tests exercise the request path only. The post-commit window runner
// would otherwise outlive a test's app and hit a closed database; the runner
// itself is covered in engine.
func init() {
	engine.Background = func(func()) {}
}
