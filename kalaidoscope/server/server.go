package server

import (
	"log"
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/handlers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/organize"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"

	_ "github.com/north-shore-software/kalaido/kalaidoscope/migrations"
)

func New(hideStartBanner bool) *pocketbase.PocketBase {
	return NewWithConfig(pocketbase.Config{HideStartBanner: hideStartBanner})
}

func NewWithConfig(config pocketbase.Config) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(config)

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: false,
	})

	// PocketBase's installer opens the OS browser at the superuser dashboard once
	// the listener binds, and it re-fires on every start because we never create a
	// _superusers record (the app authenticates as `users`). Nil it out — the
	// dashboard stays reachable at /_/ for anyone who creates a superuser by hand.
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.InstallerFunc = nil
		// A generation claim row is only live while its goroutine runs in this
		// process; anything present at boot belongs to a crashed run.
		engine.SweepGenerationClaims(app)
		return se.Next()
	})

	RegisterTriggers(app)
	RegisterRoutes(app)
	usage.Setup(app)
	colour.SetWorkerApp(app)
	engine.SetLensWorkerApp(app)
	reconcile.Register(app)
	mapping.Register(app)
	organize.Register(app)
	registerQueueStatus(app)

	// After se.Next() so it runs once the rest of the boot chain — model set
	// resolution and workspace config load are registered later, by the
	// binary's main — has decided which provider is active.
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := se.Next(); err != nil {
			return err
		}
		llmq.Reconfigure(llmq.ConfigForProvider(llm.ActiveProviderID()))
		return nil
	})

	return app
}

func RegisterTriggers(app core.App) {
	app.OnRecordCreate("fragment").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetDateTime("source_time").IsZero() {
			e.Record.Set("source_time", types.NowDateTime())
		}
		if e.Record.GetString("origin") == "" {
			e.Record.Set("origin", "app")
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("fragment").BindFunc(func(e *core.RecordEvent) error {
		colour.EnqueueNewFragmentEvaluation(app, e.Record.Id)
		if e.Record.GetString("origin") != "import" {
			mapping.SignalIfBacklog(app)
		}
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
	config.RegisterHooks(app)

	// Any committed config change may move a role's effective model out from
	// under an approved lens; the drift pass is cheap when nothing moved.
	// Registered here rather than in config to keep config free of an engine
	// dependency; it fires after the hook above has published the new config,
	// so the pass resolves against the new state.
	app.OnRecordAfterUpdateSuccess(config.CollectionName).BindFunc(func(e *core.RecordEvent) error {
		engine.RequestLensDistill()
		return e.Next()
	})
}

func RegisterRoutes(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/chat", handlers.HandleChat(app, handlers.HandleChatForRefinement))

		se.Router.POST("/api/ingest", handlers.HandleIngest(app))

		se.Router.POST("/api/context/tokens", handlers.HandleResolveTokens(app))

		se.Router.GET("/api/llm/preflight", handlers.HandleModelPreflight(app))

		se.Router.POST("/api/llm/validate", handlers.HandleValidateProvider(app))

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

		// Speculative "generate all" wave over the stale set
		se.Router.POST("/api/reconcile", handlers.HandleReconcile(app))

		se.Router.POST("/api/map", handlers.HandleMapKick(app))

		se.Router.POST("/api/organize", handlers.HandleOrganizeKick(app))

		return se.Next()
	})
}

func EnsureReady() {
	if !llm.Ready() {
		log.Fatal("server.EnsureReady: no LLM provider registered; call llm.SetProviderFactory before EnsureReady")
	}
}
