package llm

import (
	"context"
	"fmt"
	"sync"
)

var (
	providerFactory func(model string, cfg WorkspaceConfig) Provider
	activeSet       = SetLocal

	workspaceMu  sync.RWMutex
	workspaceCfg WorkspaceConfig
)

// WorkspaceConfig is this workspace's own provider selection, loaded from its
// PocketBase database rather than the process environment.
//
// The zero value means "not configured", and every lookup then falls back to
// the env-seeded model set — which is what pre-BYOK workspaces and the managed
// cloud deployment continue to use.
type WorkspaceConfig struct {
	Provider     ProviderID
	APIKey       string
	DefaultModel string
	RoleModels   map[Role]string // sparse; a missing role falls back to DefaultModel
}

// Configured reports whether this workspace has chosen a provider of its own.
func (c WorkspaceConfig) Configured() bool { return c.Provider != "" }

// ModelForRole resolves a role within this config, preferring a per-role
// override over the default. Returns "" when neither is set.
func (c WorkspaceConfig) ModelForRole(r Role) string {
	if m := c.RoleModels[r]; m != "" {
		return m
	}
	return c.DefaultModel
}

// Models returns every distinct model this config references, default first.
func (c WorkspaceConfig) Models() []string {
	seen := make(map[string]bool, len(c.RoleModels)+1)
	var out []string
	add := func(m string) {
		if m == "" || seen[m] {
			return
		}
		seen[m] = true
		out = append(out, m)
	}
	add(c.DefaultModel)
	for _, r := range Roles() {
		add(c.RoleModels[r])
	}
	return out
}

// SetWorkspaceConfig replaces the active workspace config. Called once at boot
// and again after every committed config change, so a key or model edit takes
// effect without restarting the sidecar.
func SetWorkspaceConfig(cfg WorkspaceConfig) {
	// Copy the map so a later mutation by the caller can't race readers.
	if cfg.RoleModels != nil {
		clone := make(map[Role]string, len(cfg.RoleModels))
		for k, v := range cfg.RoleModels {
			clone[k] = v
		}
		cfg.RoleModels = clone
	}
	workspaceMu.Lock()
	defer workspaceMu.Unlock()
	workspaceCfg = cfg
}

// ActiveWorkspaceConfig returns the current config. The returned RoleModels map
// is shared and must be treated as read-only.
func ActiveWorkspaceConfig() WorkspaceConfig {
	workspaceMu.RLock()
	defer workspaceMu.RUnlock()
	return workspaceCfg
}

func SetProviderFactory(f func(model string, cfg WorkspaceConfig) Provider) {
	providerFactory = f
}

func Ready() bool {
	return providerFactory != nil
}

func SetActiveModelSet(s ModelSet) {
	activeSet = s
}

func ActiveModelSet() ModelSet {
	return activeSet
}

// ResolveRole maps a role to a concrete model name. A workspace that has chosen
// its own provider resolves against its stored models; everything else falls
// back to the static env-seeded table.
func ResolveRole(r Role) (string, error) {
	if cfg := ActiveWorkspaceConfig(); cfg.Configured() {
		if m := cfg.ModelForRole(r); m != "" {
			return m, nil
		}
		return "", fmt.Errorf("llm: workspace provider %q has no model for role %q", cfg.Provider, r)
	}
	return ModelFor(activeSet, r)
}

func ErrorProvider(err error) Provider {
	return errProvider{err: err}
}

type errProvider struct{ err error }

func (p errProvider) Stream(context.Context, []Message, []Tool) (*Completion, error) {
	return nil, p.err
}

// SelectedProvider builds a provider for the active workspace config.
func SelectedProvider(model string) Provider {
	return SelectedProviderForConfig(model, ActiveWorkspaceConfig())
}

// SelectedProviderForConfig builds a provider for an arbitrary — possibly
// not-yet-saved — config. This is what lets a candidate key/model be tested
// through the exact same construction path a real call uses, without the
// caller knowing which concrete provider is involved.
func SelectedProviderForConfig(model string, cfg WorkspaceConfig) Provider {
	if providerFactory == nil {
		panic("llm: no provider factory registered; call llm.SetProviderFactory at startup")
	}
	return providerFactory(model, cfg)
}
