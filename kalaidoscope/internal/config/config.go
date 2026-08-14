// Package config owns this workspace's own LLM provider configuration: the
// provider it was created with, its API key, and its per-role model choices.
//
// The values live in the workspace's own PocketBase database rather than the
// process environment, so they can be changed while the sidecar is running and
// so two workspaces on the same machine can use different providers.
package config

import (
	"encoding/json"
	"log"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// CollectionName is the singleton config collection.
const CollectionName = "kalaidoscope_config"

// Read decodes a kalaidoscope_config record into a workspace config. An
// unrecognised or empty provider yields the zero value, which callers treat as
// "unconfigured" and fall back to the env-seeded model set.
func Read(rec *core.Record) llm.WorkspaceConfig {
	if rec == nil {
		return llm.WorkspaceConfig{}
	}

	cfg := llm.WorkspaceConfig{
		Provider:     llm.ProviderID(rec.GetString("provider")),
		APIKey:       rec.GetString("api_key"),
		DefaultModel: rec.GetString("default_model"),
	}

	if raw := rec.GetString("role_models"); raw != "" && raw != "null" {
		var decoded map[string]string
		if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
			// A corrupt override map shouldn't take generation down — fall back
			// to the default model and say so.
			log.Printf("config: ignoring unreadable role_models: %v", err)
		} else if len(decoded) > 0 {
			cfg.RoleModels = make(map[llm.Role]string, len(decoded))
			for k, v := range decoded {
				if v != "" {
					cfg.RoleModels[llm.Role(k)] = v
				}
			}
		}
	}

	return cfg
}

// Find returns the singleton config record, or nil if it doesn't exist yet.
func Find(app core.App) *core.Record {
	recs, err := app.FindAllRecords(CollectionName)
	if err != nil || len(recs) == 0 {
		return nil
	}
	return recs[0]
}

// LoadAtBoot publishes the stored provider config so the first generation call
// after startup already routes to the right provider. A workspace that has
// never chosen one leaves the zero value in place, which is exactly the
// behaviour of not calling this at all.
func LoadAtBoot(a *pocketbase.PocketBase) {
	a.OnServe().BindFunc(func(se *core.ServeEvent) error {
		rec := Find(a)
		if rec == nil {
			return se.Next()
		}
		cfg := Read(rec)
		if !cfg.Configured() {
			return se.Next()
		}
		llm.SetWorkspaceConfig(cfg)
		log.Printf("provider: loaded %q (default model %q, %d role overrides)",
			cfg.Provider, cfg.DefaultModel, len(cfg.RoleModels))
		return se.Next()
	})
}
