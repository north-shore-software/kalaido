// UNREVIEWED
package workerutil

import "context"

// Service represents a long-lived background component with a run loop.
type Service interface {
	Run(ctx context.Context) error
}
