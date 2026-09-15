package server

import (
	"log"
	"net/http"
	"strconv"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/handlers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ingest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"

	// The core upgrade deltas register themselves on import.
	_ "github.com/north-shore-software/kalaido/kalaidoscope/schema/deltas"
)

func New(hideStartBanner bool) *pocketbase.PocketBase {
	return NewWithConfig(pocketbase.Config{HideStartBanner: hideStartBanner})
}

func NewWithConfig(config pocketbase.Config) *pocketbase.PocketBase {
	return NewWithSchema(config, schema.Options{})
}

// NewWithSchema is NewWithConfig with the schema runner tuned for a flavour
// (the cloud binary hands it a hook to close Litestream before a restore).
func NewWithSchema(config pocketbase.Config, schemaOpts schema.Options) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(config)

	// Creates a new database from the canonical schema, or upgrades an old
	// one, inside bootstrap — before anything below runs against collections.
	schema.Install(app, schemaOpts)
	schema.RegisterCommand(app.RootCmd)

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

	registerWriteEcho(app)
	RegisterTriggers(app)
	RegisterRoutes(app)
	usage.Setup(app)
	colour.Register(app)
	reconcile.Register(app)
	mapping.Register(app)
	// Order matters: colour recomputes thing-backed membership from the
	// settled map, then the wave regenerates whatever that membership feeds.
	mapping.OnSettle(colour.OnMapSettled)
	mapping.OnSettle(reconcile.OnMapSettled)
	colour.OnDrained(reconcile.EnqueueWave)
	discover.Register(app)
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
		if e.Record.GetDateTime("occurred_at").IsZero() {
			e.Record.Set("occurred_at", types.NowDateTime())
		}
		if e.Record.GetString("ingested_via") == "" {
			e.Record.Set("ingested_via", "app")
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("fragment").BindFunc(func(e *core.RecordEvent) error {
		colour.Signal()
		if e.Record.GetString("ingested_via") != "import" {
			mapping.SignalAnnotate()
			// A fragment written from the app (a note, a hand edit, a saved
			// bookmark) is in scope the moment it lands. Imports signal once,
			// when the whole batch is in (ingest.processIngestRecord).
			reconcile.EnqueueWave()
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
}

func RegisterRoutes(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Every response names the schema this server speaks, and one route
		// reports the database's state, so a client (or the cloud proxy) can
		// tell a version mismatch from any other failure. Nothing is enforced
		// on requests yet; that is the client-side half, still to come.
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

		// Chat bookmarks: the session's gathered messages and what becomes of them.
		se.Router.PATCH("/api/chat/conversations/{cid}/messages/{mid}/bookmark", handlers.HandleBookmarkMessage(app))
		se.Router.POST("/api/chat/conversations/{cid}/bookmarks/save", handlers.HandleSaveBookmarks(app))
		se.Router.POST("/api/chat/conversations/{cid}/brief", handlers.HandleChatBrief(app))

		se.Router.GET("/api/llm/preflight", handlers.HandleModelPreflight(app))

		se.Router.POST("/api/llm/validate", handlers.HandleValidateProvider(app))

		// Projections
		se.Router.POST("/api/projections", handlers.HandleCreateProjection(app))
		se.Router.PATCH("/api/projections/{id}", handlers.HandleUpdateProjection(app))
		se.Router.DELETE("/api/projections/{id}", handlers.HandleDeleteProjection(app))
		se.Router.POST("/api/projections/{id}/restore", handlers.HandleRestoreProjection(app))
		se.Router.POST("/api/projections/{id}/candidates", handlers.HandleGenerateCandidate(app))
		se.Router.POST("/api/projections/{id}/candidates/{rid}/approve", handlers.HandleApproveCandidate(app))
		se.Router.POST("/api/projections/{id}/candidates/{rid}/edit", handlers.HandleEditCandidate(app))
		se.Router.POST("/api/projections/{id}/refinements", handlers.HandleCreateProjectionRefinement(app))
		se.Router.POST("/api/projections/{id}/refinements/{rid}/commit", handlers.HandleCommitProjectionRefinement(app))

		// Reflections
		se.Router.POST("/api/reflections", handlers.HandleCreateReflection(app))
		se.Router.PATCH("/api/reflections/{id}", handlers.HandleUpdateReflection(app))
		se.Router.DELETE("/api/reflections/{id}", handlers.HandleDeleteReflection(app))
		se.Router.POST("/api/reflections/{id}/restore", handlers.HandleRestoreReflection(app))
		se.Router.POST("/api/reflections/{id}/generate-snapshot", handlers.HandleGenerateReflectionSnapshot(app))
		se.Router.GET("/api/reflections/{id}/windows", handlers.HandleListReflectionWindows(app))
		se.Router.POST("/api/reflections/{id}/backfill", handlers.HandleBackfillReflection(app))
		se.Router.POST("/api/reflections/{id}/refinements", handlers.HandleCreateReflectionRefinement(app))
		se.Router.POST("/api/reflections/{id}/refinements/{rid}/commit", handlers.HandleCommitReflectionRefinement(app))

		// Colour endpoints
		se.Router.POST("/api/colours/preview", handlers.HandlePreviewColour(app))
		se.Router.POST("/api/colours", handlers.HandleCreateColour(app))
		se.Router.PATCH("/api/colours/{id}", handlers.HandleUpdateColour(app))
		se.Router.DELETE("/api/colours/{id}", handlers.HandleDeleteColour(app))
		se.Router.POST("/api/colours/{id}/rematch", handlers.HandleRematchColour(app))

		// Rotation / Staleness endpoint
		se.Router.GET("/api/rotation", handlers.HandleGetRotation(app))

		se.Router.GET("/api/organize", handlers.HandleGetOrganize(app))

		// Speculative "generate all" wave over the stale set
		se.Router.POST("/api/reconcile", handlers.HandleReconcile(app))

		se.Router.POST("/api/map", handlers.HandleMapKick(app))

		se.Router.POST("/api/discover", handlers.HandleDiscoverKick(app))

		return se.Next()
	})
}

func EnsureReady() {
	if !llm.Ready() {
		log.Fatal("server.EnsureReady: no LLM provider registered; call llm.SetProviderFactory before EnsureReady")
	}
}
