package handlers

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// HandleValidateProvider live-tests a candidate provider config and reports the
// result without persisting anything.
//
// Saving the config validates it too, so this exists for the case where a save
// is the wrong move: choosing a provider is irreversible, so the UI needs a way
// to try a key before committing to one.
func HandleValidateProvider(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.ValidateProviderRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if req.Provider == "" {
			return e.BadRequestError("provider is required", nil)
		}

		cfg := llm.WorkspaceConfig{
			Provider:     llm.ProviderID(req.Provider),
			APIKey:       req.APIKey,
			DefaultModel: req.DefaultModel,
		}
		if len(req.RoleModels) > 0 {
			cfg.RoleModels = make(map[llm.Role]string, len(req.RoleModels))
			for k, v := range req.RoleModels {
				if v != "" {
					cfg.RoleModels[llm.Role(k)] = v
				}
			}
		}

		if len(cfg.Models()) == 0 {
			return e.BadRequestError("a model is required", nil)
		}

		err := config.ValidateConfig(e.Request.Context(), cfg)
		if err == nil {
			return e.JSON(http.StatusOK, api.ValidateProviderResponse{OK: true})
		}

		resp := api.ValidateProviderResponse{OK: false, Detail: err.Error()}
		var perr *llm.ProviderError
		if errors.As(err, &perr) {
			resp.Kind = string(perr.Kind)
			resp.Provider = string(perr.Provider)
			resp.Model = perr.Model
		}
		return e.JSON(http.StatusOK, resp)
	}
}
