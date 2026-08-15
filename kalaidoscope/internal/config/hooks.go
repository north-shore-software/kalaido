package config

import (
	"errors"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// RegisterHooks guards the config singleton: model_set stays superuser-only,
// and no credential or model reaches the database without a live call proving
// it works.
func RegisterHooks(app core.App) {
	// Update is open to the authenticated app user so the provider fields can
	// be edited, but model_set decides which artifacts this workspace stamps
	// and must not ride along on that. PocketBase rules are per-collection, not
	// per-field, so the narrowing happens here.
	app.OnRecordUpdateRequest(CollectionName).BindFunc(func(e *core.RecordRequestEvent) error {
		info, err := e.RequestInfo()
		if err != nil {
			return err
		}
		if _, touched := info.Body["model_set"]; touched && !info.HasSuperuserAuth() {
			return apis.NewForbiddenError("model_set can only be changed by a superuser", nil)
		}
		return e.Next()
	})

	// Model-level, so it also covers programmatic saves rather than only the
	// REST route. Runs after the submitted values are loaded but before the row
	// is written, which is what makes rejection here mean "nothing persisted".
	app.OnRecordUpdate(CollectionName).BindFunc(func(e *core.RecordEvent) error {
		orig := Read(e.Record.Original())
		next := Read(e.Record)

		// The provider is deliberately changeable. Pinning it for the workspace's
		// lifetime meant the setup form could not record "ollama" at all without
		// locking the choice in, so it recorded nothing — leaving the selection a
		// label rather than saved state. Switching between providers is validated
		// like any other change: the credential and models below have to prove
		// themselves before the row is written.

		if next.Configured() {
			if len(next.Models()) == 0 {
				return apis.NewBadRequestError(
					"a model is required when a provider is set",
					map[string]any{"default_model": validation.NewError(
						"model_required",
						"a model is required when a provider is set",
					)},
				)
			}

			// Providers without a credential (a local service like Ollama) are
			// not live-checked: that would make settings unreachable whenever
			// the service is down, and matches how model choice behaved before.
			if llm.RequiresCredential(next.Provider) && next.APIKey != "" {
				if models := ModelsNeedingValidation(orig, next); len(models) > 0 {
					if err := ValidateModels(e.Context, next, models); err != nil {
						return validationError(err)
					}
				}
			}
		}

		if err := e.Next(); err != nil {
			return err
		}

		// Only once the write has actually committed. Generation picks this up
		// on the next call, with no restart.
		llm.SetWorkspaceConfig(next)
		return nil
	})
}

// validationError turns a classified provider failure into a response the UI
// can act on — telling "your key is wrong" apart from "the provider is down".
//
// The payload has to be a validation.Error: PocketBase rewrites any error data
// it can't read as a safe error item into a bare "Invalid value.", which would
// throw away the classification. Keying it on api_key also lets a form attach
// the message to the field the user has to fix.
func validationError(err error) error {
	var perr *llm.ProviderError
	if errors.As(err, &perr) {
		return apis.NewBadRequestError(
			"provider validation failed: "+perr.Error(),
			map[string]any{"api_key": validation.NewError(
				"provider_"+string(perr.Kind),
				perr.Error(),
			)},
		)
	}
	return apis.NewBadRequestError(
		"provider validation failed",
		map[string]any{"api_key": validation.NewError("provider_validation_failed", err.Error())},
	)
}
