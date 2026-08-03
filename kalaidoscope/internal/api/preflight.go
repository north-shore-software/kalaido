package api

type ModelPreflightRole struct {
	Role     string `json:"role"`
	Model    string `json:"model,omitempty"`
	Provider string `json:"provider,omitempty"`
	OK       bool   `json:"ok"`
	Detail   string `json:"detail,omitempty"`
}

type ModelPreflightResponse struct {
	ModelSet string               `json:"modelSet"`
	OK       bool                 `json:"ok"`
	Roles    []ModelPreflightRole `json:"roles"`
}
