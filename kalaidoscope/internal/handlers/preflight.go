package handlers

import (
	"net/http"
	"os"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// HandleModelPreflight reports whether each role can actually run.
//
// A workspace that chose its own provider is checked against its stored config:
// its models are free text, so the static model->provider table can't be
// consulted, and its credential lives in the database rather than the
// environment. Everything else keeps the original env-based check.
func HandleModelPreflight(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		cfg := llm.ActiveWorkspaceConfig()
		if cfg.Configured() {
			return e.JSON(http.StatusOK, workspacePreflight(cfg))
		}
		return e.JSON(http.StatusOK, modelSetPreflight())
	}
}

func workspacePreflight(cfg llm.WorkspaceConfig) api.ModelPreflightResponse {
	resp := api.ModelPreflightResponse{ModelSet: string(llm.ActiveModelSet()), OK: true}

	needsKey := llm.RequiresCredential(cfg.Provider)
	for _, role := range llm.Roles() {
		entry := api.ModelPreflightRole{
			Role:     string(role),
			Provider: string(cfg.Provider),
			Model:    cfg.ModelForRole(role),
		}

		switch {
		case entry.Model == "":
			entry.Detail = "no model configured for this role"
			resp.OK = false
		case needsKey && cfg.APIKey == "":
			entry.Detail = "no API key configured for this workspace"
			resp.OK = false
		default:
			entry.OK = true
		}

		resp.Roles = append(resp.Roles, entry)
	}

	return resp
}

func modelSetPreflight() api.ModelPreflightResponse {
	set := llm.ActiveModelSet()
	resp := api.ModelPreflightResponse{ModelSet: string(set), OK: true}

	for _, role := range llm.Roles() {
		entry := api.ModelPreflightRole{Role: string(role)}

		model, err := llm.ModelFor(set, role)
		if err != nil {
			entry.Detail = err.Error()
			resp.OK = false
			resp.Roles = append(resp.Roles, entry)
			continue
		}
		entry.Model = model

		provider, err := llm.ProviderFor(model)
		if err != nil {
			entry.Detail = err.Error()
			resp.OK = false
			resp.Roles = append(resp.Roles, entry)
			continue
		}
		entry.Provider = string(provider)

		if env := llm.CredentialEnv(provider); env != "" && os.Getenv(env) == "" {
			entry.Detail = env + " is not set"
			resp.OK = false
		} else {
			entry.OK = true
		}

		resp.Roles = append(resp.Roles, entry)
	}

	return resp
}
