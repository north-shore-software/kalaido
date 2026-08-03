package api

type ReflectionSnapshotResponse struct {
	SnapshotIDs []string `json:"snapshotIds"`
}

type CreateReflectionRequest struct {
	ClientID string `json:"clientId"`
	Name     string `json:"name"`
}

type CreateReflectionResponse struct {
	ReflectionID string `json:"reflectionId"`
}

type UpdateReflectionRequest struct {
	Name   *string `json:"name,omitempty"`
	Pinned *bool   `json:"pinned,omitempty"`
}
