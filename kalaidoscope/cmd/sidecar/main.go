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

	"github.com/north-shore-software/kalaido/kalaidoscope/gemini"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/ollama"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/north-shore-software/kalaido/kalaidoscope/server"
)

// logger is the process logger tagged with this package.
func logger() *slog.Logger { return slog.Default().With("component", "sidecar") }

func main() {
	// The environment is read exactly once, here, and fails the launch
	// rather than the branch that would have used a bad value.
	env, err := config.LoadEnv()
	if err != nil {
		fmt.Fprintln(os.Stderr, "kalaidoscope:", err)
		os.Exit(1)
	}
	// Logs go to stderr: stdout is the host's channel for KALAIDO_PORT and
	// KALAIDO_USER_TOKEN, and must carry nothing else it has to parse around.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: env.LogLevel})))
	llm.Trace = env.LLMTrace

	a := server.NewWithOptions(pocketbase.Config{HideStartBanner: true}, schema.Options{}, server.Options{AutoWave: env.AutoWave})

	resolveModelSet(a, env)
	config.LoadAtBoot(a)

	// The one place a provider gets wired up. A workspace that chose its own
	// provider dispatches on that choice — note this path never consults the
	// static providerByModel table, which is what lets a BYOK workspace use a
	// free-text model name the table has never heard of.
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		switch cfg.Provider {
		case llm.ProviderGemini:
			return &gemini.Provider{Model: model, APIKey: cfg.APIKey}
		case llm.ProviderOllama:
			return &ollama.OllamaProvider{Model: model}
		}

		// Unconfigured: the pre-BYOK path, resolved from the env-seeded model
		// set with credentials from the environment.
		provider, err := llm.ProviderFor(model)
		if err != nil {
			return llm.ErrorProvider(err)
		}
		switch provider {
		case llm.ProviderGemini:
			return &gemini.Provider{Model: model}
		default:
			return &ollama.OllamaProvider{Model: model}
		}
	})
	ollama.RegisterRoutes(a)
	ollama.RegisterPreload(a)
	seedSidecarUser(a, env)
	reportPort(a)
	server.EnsureReady()

	if err := a.Start(); err != nil {
		logger().Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func reportPort(a *pocketbase.PocketBase) {
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

// resolveModelSet makes the database authoritative for this scope's model set.
//
// On first init the single kalaidoscope_config row is empty, so we seed it from
// KALAIDO_MODEL_SET (default local) — this is the one moment the environment
// decides. On every start after, the stored value wins; a KALAIDO_MODEL_SET that
// disagrees is warned about and ignored, because flipping an initialized scope's
// set implies regenerating its stamped artifacts and is a deliberate operation
// (a future route), not an env toggle.
func resolveModelSet(a *pocketbase.PocketBase, env config.Env) {
	a.OnServe().BindFunc(func(se *core.ServeEvent) error {
		col, err := a.FindCollectionByNameOrId("kalaidoscope_config")
		if err != nil {
			logger().Warn("model set: config collection unavailable; using default", "error", err, "model_set", llm.ActiveModelSet())
			return se.Next()
		}

		var rec *core.Record
		if existing, err := a.FindAllRecords("kalaidoscope_config"); err == nil && len(existing) > 0 {
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
				logger().Warn("model set: failed to seed config; using it for this run only", "error", err, "model_set", set)
				llm.SetActiveModelSet(set)
				return se.Next()
			}
			llm.SetActiveModelSet(set)
			logger().Info("model set seeded", "model_set", set)
			return se.Next()
		}

		set, err := llm.ParseModelSet(stored)
		if err != nil {
			// A corrupt stored value shouldn't route generation somewhere
			// unexpected — fail loudly rather than silently defaulting.
			logger().Error("model set: stored value is invalid", "stored", stored, "error", err)
			os.Exit(1)
		}
		if env.ModelSetRaw != "" && env.ModelSetRaw != stored {
			logger().Warn("model set: KALAIDO_MODEL_SET ignored; this scope was initialized with another set (changing it requires regenerating its artifacts)", "env", env.ModelSetRaw, "stored", stored)
		}
		llm.SetActiveModelSet(set)
		logger().Info("model set loaded", "model_set", set)
		return se.Next()
	})
}

func seedSidecarUser(a *pocketbase.PocketBase, env config.Env) {
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
			logger().Error("seed user: set password failed", "error", err)
			return se.Next()
		}
		token, err := record.NewAuthToken()
		if err != nil {
			logger().Error("seed user: create JWT failed", "error", err)
			return se.Next()
		}

		// Print the token to stdout for Tauri to capture
		fmt.Printf("KALAIDO_USER_TOKEN=%s\n", token)

		return se.Next()
	})
}
