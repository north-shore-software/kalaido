package config

import (
	"context"
	"sync"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// validationDeadline bounds a whole validation pass rather than each call, so a
// config with five per-role models can't stack five timeouts onto one request.
const validationDeadline = 20 * time.Second

// ValidateConfig makes a live call against every model the config references.
//
// It goes through the same provider construction and Stream path a real
// generation uses, so an invalid key, a model the key can't reach, and an
// exhausted quota all surface exactly as they would in production. It knows
// nothing about any concrete provider, so a new one needs no change here.
func ValidateConfig(ctx context.Context, cfg llm.WorkspaceConfig) error {
	return ValidateModels(ctx, cfg, cfg.Models())
}

// ValidateModels validates a specific subset of models concurrently, under one
// shared deadline. The error from the earliest-listed failing model wins, so
// the message a user sees is stable across runs.
func ValidateModels(ctx context.Context, cfg llm.WorkspaceConfig, models []string) error {
	if len(models) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, validationDeadline)
	defer cancel()

	errs := make([]error, len(models))
	var wg sync.WaitGroup
	for i, model := range models {
		wg.Add(1)
		go func(i int, model string) {
			defer wg.Done()
			errs[i] = validateModel(ctx, cfg, model)
		}(i, model)
	}
	wg.Wait()

	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

func validateModel(ctx context.Context, cfg llm.WorkspaceConfig, model string) error {
	comp, err := llm.SelectedProviderForConfig(model, cfg).Stream(
		ctx,
		[]llm.Message{{Role: "user", Content: prompts.ValidationPing}},
		nil,
		llm.GenOptions{},
	)
	if err != nil {
		return err
	}
	// Drain so the provider's reader goroutine finishes and the response body
	// is closed; Wait blocks until it has.
	for range comp.Events {
	}
	comp.Wait()
	return nil
}

// ModelsNeedingValidation narrows a config change down to the models that
// actually have to be tested. Changing the credential or the provider
// invalidates everything; otherwise only newly referenced models need a call,
// so the common edits (rotate the key aside, retarget one role) cost one
// request instead of five.
func ModelsNeedingValidation(orig, next llm.WorkspaceConfig) []string {
	if next.Provider != orig.Provider || next.APIKey != orig.APIKey {
		return next.Models()
	}

	known := make(map[string]bool)
	for _, m := range orig.Models() {
		known[m] = true
	}

	var out []string
	for _, m := range next.Models() {
		if !known[m] {
			out = append(out, m)
		}
	}
	return out
}
