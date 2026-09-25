package config

import (
	"log/slog"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func TestParseEnvDefaults(t *testing.T) {
	t.Parallel()
	env, err := parseEnv(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if env.ModelSet != "" || env.AutoWave || env.LLMTrace || env.UserPassword != "" || env.HandEditCreateFragment {
		t.Errorf("empty environment produced non-zero settings: %+v", env)
	}
	if env.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v, want info", env.LogLevel)
	}
}

func TestParseEnvValues(t *testing.T) {
	t.Parallel()
	vars := map[string]string{
		"KALAIDO_MODEL_SET":                 "cloud",
		"KALAIDO_USER_PASSWORD":             "pw",
		"KALAIDO_AUTO_WAVE":                 "1",
		"KALAIDO_LLM_TRACE":                 "1",
		"KALAIDO_HAND_EDIT_CREATE_FRAGMENT": "1",
		"KALAIDO_LOG_LEVEL":                 "DEBUG",
	}
	env, err := parseEnv(func(k string) string { return vars[k] })
	if err != nil {
		t.Fatal(err)
	}
	if env.ModelSet != llm.SetCloud || env.ModelSetRaw != "cloud" {
		t.Errorf("ModelSet = %q (raw %q), want cloud", env.ModelSet, env.ModelSetRaw)
	}
	if env.UserPassword != "pw" || !env.AutoWave || !env.LLMTrace || !env.HandEditCreateFragment {
		t.Errorf("settings not read: %+v", env)
	}
	if env.LogLevel != slog.LevelDebug {
		t.Errorf("LogLevel = %v, want debug", env.LogLevel)
	}

	aliasEnv, err := parseEnv(func(k string) string {
		if k == "KALAIDO_CREATE_EDIT_FRAGMENTS" {
			return "true"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	if !aliasEnv.HandEditCreateFragment {
		t.Errorf("KALAIDO_CREATE_EDIT_FRAGMENTS alias not read: %+v", aliasEnv)
	}
}

func TestParseEnvRejectsBadValues(t *testing.T) {
	t.Parallel()
	for name, vars := range map[string]map[string]string{
		"model set": {"KALAIDO_MODEL_SET": "nope"},
		"log level": {"KALAIDO_LOG_LEVEL": "loud"},
	} {
		if _, err := parseEnv(func(k string) string { return vars[k] }); err == nil {
			t.Errorf("%s: bad value accepted", name)
		}
	}
}

func TestFlagParsing(t *testing.T) {
	t.Parallel()
	for raw, want := range map[string]bool{
		"": false, "0": false, "false": false, "FALSE": false, "no": false, "off": false,
		"1": true, "true": true, "yes": true, "on": true, "anything": true,
	} {
		if got := flag(raw); got != want {
			t.Errorf("flag(%q) = %v, want %v", raw, got, want)
		}
	}
}
