package quota

import (
	"context"

	"github.com/pocketbase/pocketbase/core"
)

type Authorizer interface {
	Allowed(ctx context.Context, app core.App) bool
	Record(ctx context.Context, app core.App, used int64)
}

var authorizer Authorizer

func Set(a Authorizer) { authorizer = a }

func Get() Authorizer { return authorizer }
