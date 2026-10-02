package main

import (
	"path/filepath"
	"testing"
)

func TestParseDirFlag(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		def      string
		expected string
	}{
		{
			name:     "no dir flag returns default",
			args:     []string{"sidecar", "serve"},
			def:      "./pb_data",
			expected: "./pb_data",
		},
		{
			name:     "dir flag with equals",
			args:     []string{"sidecar", "serve", "--dir=/path/to/workspaces/ws-123"},
			def:      "./pb_data",
			expected: "/path/to/workspaces/ws-123",
		},
		{
			name:     "dir flag with space / separate arg",
			args:     []string{"sidecar", "serve", "--dir", "/path/to/workspaces/ws-456", "--dev"},
			def:      "./pb_data",
			expected: "/path/to/workspaces/ws-456",
		},
		{
			name:     "dir flag at end without value",
			args:     []string{"sidecar", "serve", "--dir"},
			def:      "./pb_data",
			expected: "./pb_data",
		},
		{
			name:     "empty args list",
			args:     []string{},
			def:      "./pb_data",
			expected: "./pb_data",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseDirFlag(tt.args, tt.def)
			if got != tt.expected {
				t.Errorf("parseDirFlag(%v, %q) = %q, want %q", tt.args, tt.def, got, tt.expected)
			}
		})
	}
}

func TestScopeIDFromDir(t *testing.T) {
	args := []string{"sidecar", "serve", "--dir", "/home/user/.local/share/kalaido/workspaces/scope-xyz"}
	dataDir := parseDirFlag(args, "./pb_data")
	scopeID := filepath.Base(dataDir)

	if scopeID != "scope-xyz" {
		t.Errorf("expected scopeID %q, got %q", "scope-xyz", scopeID)
	}
}
