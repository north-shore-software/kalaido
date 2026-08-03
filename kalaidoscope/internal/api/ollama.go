package api

type ModelInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type OllamaStatusResponse struct {
	Reachable bool        `json:"reachable"`
	Models    []ModelInfo `json:"models"`
	Error     string      `json:"error,omitempty"`
}

type OllamaPullRequest struct {
	Model string `json:"model"`
}
