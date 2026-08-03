package server

import (
	"log"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/internal/colour"
	"github.com/north-shore-software/kalaido/internal/handlers"
	"github.com/north-shore-software/kalaido/internal/ingest"
	"github.com/north-shore-software/kalaido/internal/usage"
	"github.com/north-shore-software/kalaido/llm"

	_ "github.com/north-shore-software/kalaido/migrations"
)

func New(hideStartBanner bool) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(pocketbase.Config{HideStartBanner: hideStartBanner})

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: false,
	})

	RegisterTriggers(app)
	RegisterRoutes(app)
	usage.Setup(app)
	colour.SetWorkerApp(app)

	return app
}

func RegisterTriggers(app core.App) {
	app.OnRecordCreate("fragment").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetDateTime("source_time").IsZero() {
			e.Record.Set("source_time", types.NowDateTime())
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("fragment").BindFunc(func(e *core.RecordEvent) error {
		colour.EnqueueNewFragmentEvaluation(app, e.Record.Id)
		return e.Next()
	})

	ingest.RegisterHooks(app)
}

func RegisterRoutes(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/chat", handlers.HandleChat(app, handlers.HandleChatForRefinement))

		se.Router.POST("/api/ingest", handlers.HandleIngest(app))

		se.Router.POST("/api/context/tokens", handlers.HandleResolveTokens(app))

		se.Router.GET("/api/llm/preflight", handlers.HandleModelPreflight(app))

		// Projections
		se.Router.POST("/api/projections", handlers.HandleCreateProjection(app))
		se.Router.PATCH("/api/projections/{id}", handlers.HandleUpdateProjection(app))
		se.Router.DELETE("/api/projections/{id}", handlers.HandleDeleteProjection(app))
		se.Router.POST("/api/projections/{id}/candidates", handlers.HandleGenerateCandidate(app))
		se.Router.POST("/api/projections/{id}/candidates/{rid}/approve", handlers.HandleApproveCandidate(app))
		se.Router.POST("/api/projections/{id}/refinements", handlers.HandleCreateProjectionRefinement(app))
		se.Router.POST("/api/projections/{id}/refinements/{rid}/commit", handlers.HandleCommitProjectionRefinement(app))

		// Reflections
		se.Router.POST("/api/reflections", handlers.HandleCreateReflection(app))
		se.Router.PATCH("/api/reflections/{id}", handlers.HandleUpdateReflection(app))
		se.Router.DELETE("/api/reflections/{id}", handlers.HandleDeleteReflection(app))
		se.Router.POST("/api/reflections/{id}/generate-snapshot", handlers.HandleGenerateReflectionSnapshot(app))
		se.Router.POST("/api/reflections/{id}/refinements", handlers.HandleCreateReflectionRefinement(app))
		se.Router.POST("/api/reflections/{id}/refinements/{rid}/commit", handlers.HandleCommitReflectionRefinement(app))

		// Colour endpoints
		se.Router.POST("/api/colours/preview", handlers.HandlePreviewColour(app))
		se.Router.POST("/api/colours", handlers.HandleCreateColour(app))
		se.Router.PATCH("/api/colours/{id}", handlers.HandleUpdateColour(app))

		// Rotation / Staleness endpoint
		se.Router.GET("/api/rotation", handlers.HandleGetRotation(app))

		return se.Next()
	})
}

func EnsureReady() {
	if !llm.Ready() {
		log.Fatal("server.EnsureReady: no LLM provider registered; call llm.SetProviderFactory before EnsureReady")
	}
}
