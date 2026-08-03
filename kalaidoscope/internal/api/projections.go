package api

type ProjectionSnapshotResponse struct {
	SnapshotID string `json:"snapshotId"`
}

type CreateProjectionRequest struct {
	ClientID string `json:"clientId"`
	Name     string `json:"name"`
}

type CreateProjectionResponse struct {
	ProjectionID string `json:"projectionId"`
}

type UpdateProjectionRequest struct {
	Name   *string `json:"name,omitempty"`
	Pinned *bool   `json:"pinned,omitempty"`
}
