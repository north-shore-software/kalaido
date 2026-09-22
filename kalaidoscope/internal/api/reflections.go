// UNREVIEWED
package api

type ReflectionSnapshotResponse struct {
	SnapshotIDs []string `json:"snapshotIds"`
}

type CreateReflectionResponse struct {
	ReflectionID string `json:"reflectionId"`
}
