// UNREVIEWED
package ollama

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func RegisterRoutes(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/ollama/status", HandleOllamaStatus)
		se.Router.POST("/api/ollama/pull", HandleOllamaPull)
		return se.Next()
	})
}

func RegisterPreload(app core.App) {
	ctx, cancel := context.WithCancel(context.Background())
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		go preloadDefaultModel(ctx)
		return se.Next()
	})
	app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		cancel()
		return te.Next()
	})
}

func preloadDefaultModel(ctx context.Context) {
	const (
		retryDelay = 5 * time.Second
		maxWait    = 2 * time.Minute
	)
	deadline := time.Now().Add(maxWait)
	for {
		if err := PreloadModel(ctx, defaultModel); err == nil {
			logger().Info("model resident", "model", defaultModel)
			return
		} else if time.Now().After(deadline) {
			logger().Warn("giving up on model preload", "model", defaultModel, "error", err)
			return
		} else {
			logger().Warn("model not ready, retrying", "model", defaultModel, "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(retryDelay):
		}
	}
}

func HandleOllamaStatus(e *core.RequestEvent) error {
	ctx, cancel := context.WithTimeout(e.Request.Context(), 5*time.Second)
	defer cancel()

	models, err := ListModels(ctx)
	if err != nil {
		return e.JSON(http.StatusOK, api.OllamaStatusResponse{
			Reachable: false,
			Models:    []api.ModelInfo{},
			Error:     err.Error(),
		})
	}
	return e.JSON(http.StatusOK, api.OllamaStatusResponse{Reachable: true, Models: models})
}

func HandleOllamaPull(e *core.RequestEvent) error {
	req := api.OllamaPullRequest{}
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("invalid pull request body", err)
	}
	if req.Model == "" {
		return e.BadRequestError("model required", nil)
	}

	w := e.Response
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	flusher, canFlush := w.(http.Flusher)
	enc := json.NewEncoder(w)
	send := func(v any) {
		_ = enc.Encode(v) // Encode appends a newline → NDJSON.
		if canFlush {
			flusher.Flush()
		}
	}

	err := PullModel(e.Request.Context(), req.Model, func(status string, completed, total int64) {
		send(map[string]any{"status": status, "completed": completed, "total": total})
	})
	if err != nil {
		send(map[string]any{"error": err.Error()})
		return nil
	}
	send(map[string]any{"status": "success", "done": true})
	return nil
}
