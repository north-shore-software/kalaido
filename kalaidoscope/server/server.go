// UNREVIEWED
package server

import (
	"log/slog"
	"net/http"
	"os"
	"strconv"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/handlers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"

	// The core upgrade deltas register themselves on import.
	_ "github.com/north-shore-software/kalaido/kalaidoscope/schema/deltas"
)

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "server")
	}
	return slog.Default().With("component", "server")
}

// Options tune the server's own components; the zero value is the default.
type Options struct {
	// AutoWave controls the reconcile worker's automatic triggers
	// (KALAIDO_AUTO_WAVE). Default off, only the dashboard's Start runs a wave.
	AutoWave bool
}

func New(config pocketbase.Config) *pocketbase.PocketBase {
	return NewWithSchema(config, schema.Options{})
}

func NewWithSchema(config pocketbase.Config, schemaOpts schema.Options) *pocketbase.PocketBase {
	return NewWithSchemaWithOptions(config, schemaOpts, Options{})
}

func NewWithSchemaWithOptions(config pocketbase.Config, schemaOpts schema.Options, opts Options) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(config)

	// Migrate or initialize database schema, if not already present.
	schema.Install(app, schemaOpts)
	schema.RegisterCommand(app.RootCmd)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// PocketBase's installer opens the OS browser at the superuser dashboard once
		// the listener binds, and it re-fires on every start because we never create a
		// _superusers record (the app authenticates as `users`). Nil it out — the
		// dashboard stays reachable at /_/ for anyone who creates a superuser by hand.
		se.InstallerFunc = nil

		// A generation claim row is only live while its goroutine runs in this
		// process, and an ingest record is only pending while its goroutine
		// holds the uploads; anything of either kind present at boot belongs
		// to a crashed run.
		engine.SweepGenerationClaims(app)
		ingest.SweepPending(app)

		return se.Next()
	})

	registerWriteEcho(app)

	rt := newRuntime(app, opts)

	RegisterTriggers(app, rt)
	RegisterRoutes(app, rt.deps())

	usage.Setup(app)

	rt.bind(app)

	registerQueueStatus(app, rt.Scheduler())

	// After se.Next() so it runs once the rest of the boot chain — model set
	// resolution and workspace config load are registered later, by the
	// binary's main — has decided which provider is active.
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := se.Next(); err != nil {
			return err
		}
		rt.Scheduler().Reconfigure(llmq.ConfigForProvider(llm.ActiveProviderID()))
		return nil
	})

	return app
}

func RegisterTriggers(app core.App, rt *runtime) {
	app.OnRecordCreate("fragment").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetDateTime("occurred_at").IsZero() {
			e.Record.Set("occurred_at", types.NowDateTime())
		}
		if e.Record.GetString("ingested_via") == "" {
			e.Record.Set("ingested_via", "app")
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("fragment").BindFunc(func(e *core.RecordEvent) error {
		rt.colour.Signal()
		if e.Record.GetString("ingested_via") != "import" {
			rt.mapping.SignalAnnotate()
			// A fragment written from the app (a note, a hand edit, a saved
			// bookmark) is in scope the moment it lands. Imports signal once,
			// when the whole batch is in (ingest.processIngestRecord).
			rt.reconcile.EnqueueWave()
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

	ingest.RegisterHooks(app, ingest.Deps{
		Mapping: rt.mapping, Reconcile: rt.reconcile, Discover: rt.discover, Runner: rt.runner,
	})
	config.RegisterHooks(app)
}

func RegisterRoutes(app core.App, deps handlers.Deps) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Every response names the schema this server speaks, and one route
		// reports the database's state.
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			e.Response.Header().Set("X-Kalaido-Schema-Version", strconv.Itoa(schema.Version))
			return e.Next()
		})

		se.Router.GET("/api/schema", func(e *core.RequestEvent) error {
			st, err := schema.CurrentStatus(app)
			if err != nil {
				return e.InternalServerError("schema status", err)
			}
			return e.JSON(http.StatusOK, st)
		})

		se.Router.POST("/api/chat", handlers.HandleChat(app, handlers.HandleChatForRefinement))

		se.Router.POST("/api/ingest", handlers.HandleIngest(app))

		se.Router.POST("/api/context/tokens", handlers.HandleResolveTokens(app))

		se.Router.GET("/api/llm/preflight", handlers.HandleModelPreflight(app))
		se.Router.POST("/api/llm/validate", handlers.HandleValidateProvider(app))

		// Chat
		se.Router.PATCH("/api/chat/conversations/{cid}/messages/{mid}/bookmark", handlers.HandleBookmarkMessage(app))
		se.Router.POST("/api/chat/conversations/{cid}/bookmarks/save", handlers.HandleSaveBookmarks(app))
		se.Router.POST("/api/chat/conversations/{cid}/brief", handlers.HandleChatBrief(app))

		// Projections
		se.Router.POST("/api/projections", handlers.HandleCreateProjection(app))
		se.Router.PATCH("/api/projections/{id}", handlers.HandleUpdateProjection(app))
		se.Router.DELETE("/api/projections/{id}", handlers.HandleDeleteProjection(app))
		se.Router.POST("/api/projections/{id}/restore", handlers.HandleRestoreProjection(app))
		se.Router.POST("/api/projections/{id}/candidates", handlers.HandleGenerateCandidate(app))
		se.Router.POST("/api/projections/{id}/candidates/{rid}/approve", handlers.HandleApproveCandidate(app, deps))
		se.Router.POST("/api/projections/{id}/candidates/{rid}/edit", handlers.HandleEditCandidate(app))
		se.Router.POST("/api/projections/{id}/refinements", handlers.HandleCreateProjectionRefinement(app))
		se.Router.POST("/api/projections/{id}/refinements/{rid}/commit", handlers.HandleCommitProjectionRefinement(app, deps))

		// Reflections
		se.Router.POST("/api/reflections", handlers.HandleCreateReflection(app))
		se.Router.PATCH("/api/reflections/{id}", handlers.HandleUpdateReflection(app))
		se.Router.DELETE("/api/reflections/{id}", handlers.HandleDeleteReflection(app))
		se.Router.POST("/api/reflections/{id}/restore", handlers.HandleRestoreReflection(app))
		se.Router.POST("/api/reflections/{id}/generate-snapshot", handlers.HandleGenerateReflectionSnapshot(app))
		se.Router.GET("/api/reflections/{id}/windows", handlers.HandleListReflectionWindows(app))
		se.Router.POST("/api/reflections/{id}/backfill", handlers.HandleBackfillReflection(app, deps.Runner))
		se.Router.POST("/api/reflections/{id}/refinements", handlers.HandleCreateReflectionRefinement(app))
		se.Router.POST("/api/reflections/{id}/refinements/{rid}/commit", handlers.HandleCommitReflectionRefinement(app, deps))

		// Colours
		se.Router.POST("/api/colours/preview", handlers.HandlePreviewColour(app))
		se.Router.POST("/api/colours", handlers.HandleCreateColour(app, deps))
		se.Router.PATCH("/api/colours/{id}", handlers.HandleUpdateColour(app, deps))
		se.Router.DELETE("/api/colours/{id}", handlers.HandleDeleteColour(app))
		se.Router.POST("/api/colours/{id}/rematch", handlers.HandleRematchColour(app, deps))

		se.Router.GET("/api/rotation", handlers.HandleGetRotation(app))

		se.Router.GET("/api/organize", handlers.HandleGetOrganize(app, deps))

		se.Router.POST("/api/reconcile", handlers.HandleReconcile(deps.Reconcile))

		se.Router.POST("/api/map", handlers.HandleMapKick(deps.Mapping))

		se.Router.POST("/api/discover", handlers.HandleDiscoverKick(deps.Discover))

		return se.Next()
	})
}

func EnsureReady() {
	if !llm.Ready() {
		logger(nil).Error("no LLM provider registered", "hint", "call llm.SetProviderFactory before EnsureReady")
		os.Exit(1)
	}
}
