package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// Env is every process-environment setting the sidecar reads, parsed once at
// boot by LoadEnv and handed down explicitly. Nothing outside this file reads
// a KALAIDO_* variable.
//
// Provider credentials (GEMINI_API_KEY, OLLAMA_HOST) are deliberately not
// here: they belong to the provider that consumes them, and the preflight
// route probes them by name.
type Env struct {
	// ModelSet seeds a fresh scope's model set (KALAIDO_MODEL_SET); "" when
	// unset. Ignored, with a warning, once the scope has been initialised.
	ModelSet llm.ModelSet
	// ModelSetRaw is the variable's literal value, kept so the boot log can
	// name what was ignored.
	ModelSetRaw string
	// UserPassword fixes the seeded local user's password
	// (KALAIDO_USER_PASSWORD); "" means a random one per run.
	UserPassword string
	// AutoWave turns on the automatic reconcile triggers (KALAIDO_AUTO_WAVE).
	AutoWave bool
	// LLMTrace logs every provider request body (KALAIDO_LLM_TRACE).
	LLMTrace bool
	// LogLevel is the minimum level written to stderr (KALAIDO_LOG_LEVEL:
	// debug, info, warn, error; default info).
	LogLevel slog.Level
	// HandEditCreateFragment controls whether manual edits to a projection draft
	// create an edit fragment (KALAIDO_HAND_EDIT_CREATE_FRAGMENT). Default false.
	HandEditCreateFragment bool
}

// LoadEnv reads the process environment. An unparseable value is an error
// so a misconfigured launch fails at boot rather than in the branch that
// would have used it.
func LoadEnv() (Env, error) {
	return parseEnv(os.Getenv)
}

// HandEditCreateFragment returns whether manual edits to a projection draft
// create an edit fragment, read from the environment.
func HandEditCreateFragment() bool {
	env, err := LoadEnv()
	if err != nil {
		return false
	}
	return env.HandEditCreateFragment
}

func parseEnv(get func(string) string) (Env, error) {
	autoWave, err := parseBool("KALAIDO_AUTO_WAVE", get("KALAIDO_AUTO_WAVE"))
	if err != nil {
		return Env{}, err
	}
	llmTrace, err := parseBool("KALAIDO_LLM_TRACE", get("KALAIDO_LLM_TRACE"))
	if err != nil {
		return Env{}, err
	}
	fragRaw := get("KALAIDO_HAND_EDIT_CREATE_FRAGMENT")
	if fragRaw == "" {
		fragRaw = get("KALAIDO_CREATE_EDIT_FRAGMENTS")
	}
	frag, err := parseBool("KALAIDO_HAND_EDIT_CREATE_FRAGMENT", fragRaw)
	if err != nil {
		return Env{}, err
	}

	env := Env{
		ModelSetRaw:            get("KALAIDO_MODEL_SET"),
		UserPassword:           get("KALAIDO_USER_PASSWORD"),
		AutoWave:               autoWave,
		LLMTrace:               llmTrace,
		HandEditCreateFragment: frag,
		LogLevel:               slog.LevelInfo,
	}
	if env.ModelSetRaw != "" {
		set, err := llm.ParseModelSet(env.ModelSetRaw)
		if err != nil {
			return Env{}, fmt.Errorf("KALAIDO_MODEL_SET: %w", err)
		}
		env.ModelSet = set
	}
	if raw := strings.TrimSpace(get("KALAIDO_LOG_LEVEL")); raw != "" {
		var lvl slog.Level
		if err := lvl.UnmarshalText([]byte(raw)); err != nil {
			return Env{}, fmt.Errorf("KALAIDO_LOG_LEVEL: %w", err)
		}
		env.LogLevel = lvl
	}
	return env, nil
}

func parseBool(name, raw string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "0", "false", "no", "off":
		return false, nil
	case "1", "true", "yes", "on":
		return true, nil
	default:
		return false, fmt.Errorf("%s: unparseable boolean value %q", name, raw)
	}
}

func flag(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "0", "false", "no", "off":
		return false
	}
	return true
}
