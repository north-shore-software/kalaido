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
