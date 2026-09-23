package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"sync"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/providers/gemini"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/providers/ollama"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/north-shore-software/kalaido/kalaidoscope/server"
)

var logger *slog.Logger

func main() {
	// Fail early and loudly if misconfigured.
	env, err := config.LoadEnv()
	if err != nil {
		// Log directly to stderr because we need env.LogLevel to configure logging.
		_, _ = fmt.Fprintln(os.Stderr, "kalaidoscope:", err)
		os.Exit(1)
	}

	// stdout is used to output KALAIDO_PORT and KALAIDO_USER_TOKEN, captured by the Tauri app.
	// stderr for all other logs.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: env.LogLevel})))
	logger = slog.Default().With("component", "sidecar")
	llm.Trace = env.LLMTrace

	a := server.NewWithSchemaWithOptions(pocketbase.Config{HideStartBanner: true}, schema.Options{}, server.Options{AutoWave: env.AutoWave})

	resolveScopeModelSet(a, env)

	config.LoadAtBoot(a)

	gemini.Register()
	ollama.Register(a)

	reportPortOnServe(a)
	createLocalAppUser(a, env)

	server.EnsureReady()

	if err := a.Start(); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func reportPortOnServe(a *pocketbase.PocketBase) {
	a.OnServe().BindFunc(func(se *core.ServeEvent) error {
		base := se.Server.BaseContext
		var once sync.Once
		se.Server.BaseContext = func(l net.Listener) context.Context {
			once.Do(func() {
				if addr, ok := l.Addr().(*net.TCPAddr); ok {
					fmt.Printf("KALAIDO_PORT=%d\n", addr.Port)
					printBanner(addr.Port)
				}
			})
			if base != nil {
				return base(l)
			}
			return context.Background()
		}
		return se.Next()
	})
}

// printBanner mirrors PocketBase's own ServeConfig.ShowStartBanner output,
// which we disable (HideStartBanner) because the library prints it before
// the listener is bound — with the sidecar's OS-assigned port (addr ":0")
// that would always show port 0.
func printBanner(port int) {
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	fmt.Printf("Server started at %s\n", baseURL)
	fmt.Printf("├─ REST API:  %s/api/\n", baseURL)
	fmt.Printf("└─ Dashboard: %s/_/\n", baseURL)
}

// resolveScopeModelSet validates the model_set stored in the database, or sets it to the environment-defined default
// if empty (new database).
func resolveScopeModelSet(a *pocketbase.PocketBase, env config.Env) {
	a.OnServe().BindFunc(func(se *core.ServeEvent) error {
		col, err := a.FindCollectionByNameOrId(schema.ColKalaidoscopeConfig.String())
		if err != nil {
			logger.Warn("model set: config collection unavailable; using default", "error", err, "model_set", llm.ActiveModelSet())
			return se.Next()
		}

		var rec *core.Record
		if existing, err := a.FindAllRecords(schema.ColKalaidoscopeConfig.String()); err == nil && len(existing) > 0 {
			rec = existing[0]
		} else {
			rec = core.NewRecord(col)
		}

		stored := rec.GetString("model_set")
		if stored == "" {
			set := llm.SetLocal
			if env.ModelSet != "" {
				set = env.ModelSet
			}
			rec.Set("model_set", string(set))
			if err := a.Save(rec); err != nil {
				logger.Warn("model set: failed to seed config; using it for this run only", "error", err, "model_set", set)
				llm.SetActiveModelSet(set)
				return se.Next()
			}
			llm.SetActiveModelSet(set)
			logger.Info("model set seeded", "model_set", set)
			return se.Next()
		}

		set, err := llm.ParseModelSet(stored)
		if err != nil {
			// A corrupt stored value shouldn't route generation somewhere
			// unexpected — fail loudly rather than silently defaulting.
			logger.Error("model set: stored value is invalid", "stored", stored, "error", err)
			os.Exit(1)
		}
		if env.ModelSetRaw != "" && env.ModelSetRaw != stored {
			logger.Warn("model set: KALAIDO_MODEL_SET ignored; this scope was initialized with another set (changing it requires regenerating its artifacts)", "env", env.ModelSetRaw, "stored", stored)
		}
		llm.SetActiveModelSet(set)
		logger.Info("model set loaded", "model_set", set)
		return se.Next()
	})
}

func createLocalAppUser(a *pocketbase.PocketBase, env config.Env) {
	a.OnServe().BindFunc(func(se *core.ServeEvent) error {
		email := "user@kalaido.local"

		col, err := a.FindCollectionByNameOrId("users")
		if err != nil {
			return se.Next()
		}

		record, err := a.FindAuthRecordByEmail("users", email)
		if err != nil {
			record = core.NewRecord(col)
			record.Set("email", email)
		}

		if env.UserPassword != "" {
			record.SetPassword(env.UserPassword)
		} else {
			record.SetRandomPassword()
		}
		if err := a.Save(record); err != nil {
			logger.Error("seed user: set password failed", "error", err)
			return se.Next()
		}
		token, err := record.NewAuthToken()
		if err != nil {
			logger.Error("seed user: create JWT failed", "error", err)
			return se.Next()
		}

		// Print the token to stdout for Tauri to capture
		fmt.Printf("KALAIDO_USER_TOKEN=%s\n", token)

		return se.Next()
	})
}
