package handlers

import (
	"net/http"
	"os"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/internal/api"
	"github.com/north-shore-software/kalaido/llm"
)

func HandleModelPreflight(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
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

		return e.JSON(http.StatusOK, resp)
	}
}
