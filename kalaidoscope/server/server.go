package server

import (
	"log"
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/handlers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"

	_ "github.com/north-shore-software/kalaido/kalaidoscope/migrations"
)

func New(hideStartBanner bool) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(pocketbase.Config{HideStartBanner: hideStartBanner})

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: false,
	})

	// PocketBase's installer opens the OS browser at the superuser dashboard once
	// the listener binds, and it re-fires on every start because we never create a
	// _superusers record (the app authenticates as `users`). Nil it out — the
	// dashboard stays reachable at /_/ for anyone who creates a superuser by hand.
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.InstallerFunc = nil
		return se.Next()
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

	app.OnRecordDeleteRequest("fragment").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetDateTime("deleted_at").IsZero() {
			e.Record.Set("deleted_at", types.NowDateTime())
			if err := e.App.Save(e.Record); err != nil {
				return err
			}
		}
		return e.NoContent(http.StatusNoContent)
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
