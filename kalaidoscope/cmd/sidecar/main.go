package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"sync"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/gemini"
	"github.com/north-shore-software/kalaido/internal/ollama"
	"github.com/north-shore-software/kalaido/llm"
	"github.com/north-shore-software/kalaido/server"
)

func main() {
	a := server.New(true)

	resolveModelSet(a)

	llm.SetProviderFactory(func(model string) llm.Provider {
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
	seedSidecarUser(a)
	reportPort(a)
	server.EnsureReady()

	if err := a.Start(); err != nil {
		log.Fatal(err)
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
// which we disable (server.New(true)) because the library prints it before
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
func resolveModelSet(a *pocketbase.PocketBase) {
	a.OnServe().BindFunc(func(se *core.ServeEvent) error {
		col, err := a.FindCollectionByNameOrId("kalaidoscope_config")
		if err != nil {

			log.Printf("model set: config collection unavailable (%v); using default %q", err, llm.ActiveModelSet())
			return se.Next()
		}

		var rec *core.Record
		if existing, err := a.FindAllRecords("kalaidoscope_config"); err == nil && len(existing) > 0 {
			rec = existing[0]
		} else {
			rec = core.NewRecord(col)
		}

		envRaw := os.Getenv("KALAIDO_MODEL_SET")

		stored := rec.GetString("model_set")
		if stored == "" {

			set := llm.SetLocal
			if envRaw != "" {
				parsed, perr := llm.ParseModelSet(envRaw)
				if perr != nil {
					log.Fatal(perr)
				}
				set = parsed
			}
			rec.Set("model_set", string(set))
			if err := a.Save(rec); err != nil {
				log.Printf("model set: failed to seed config (%v); using %q for this run", err, set)
				llm.SetActiveModelSet(set)
				return se.Next()
			}
			llm.SetActiveModelSet(set)
			log.Printf("model set: seeded %q", set)
			return se.Next()
		}

		set, err := llm.ParseModelSet(stored)
		if err != nil {
			// A corrupt stored value shouldn't route generation somewhere
			// unexpected — fail loudly rather than silently defaulting.
			log.Fatalf("model set: stored value %q is invalid: %v", stored, err)
		}
		if envRaw != "" && envRaw != stored {
			log.Printf("model set: KALAIDO_MODEL_SET=%q ignored — this scope was initialized as %q (changing it requires regenerating its artifacts)", envRaw, stored)
		}
		llm.SetActiveModelSet(set)
		log.Printf("model set: loaded %q", set)
		return se.Next()
	})
}

func seedSidecarUser(a *pocketbase.PocketBase) {
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

		if password := os.Getenv("KALAIDO_USER_PASSWORD"); password != "" {
			record.SetPassword(password)
		} else {
			record.SetRandomPassword()
		}
		if err := a.Save(record); err != nil {
			log.Printf("Error setting user password: %v", err)
			return se.Next()
		}
		token, err := record.NewAuthToken()
		if err != nil {
			log.Printf("Error creating user JWT: %v", err)
			return se.Next()
		}

		// Print the token to stdout for Tauri to capture
		fmt.Printf("KALAIDO_USER_TOKEN=%s\n", token)

		return se.Next()
	})
}
