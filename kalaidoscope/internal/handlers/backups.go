package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/routine"

	"github.com/north-shore-software/kalaido/kalaidoscope/backup"
)

func HandleListBackups(app core.App, eng *backup.Engine) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		sums, err := eng.List(e.Request.Context())
		if err != nil {
			return e.InternalServerError("failed to list backups", err)
		}
		if sums == nil {
			sums = []backup.Summary{}
		}
		return e.JSON(http.StatusOK, sums)
	}
}

func HandleCreateBackup(app core.App, eng *backup.Engine) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		sum, err := eng.Create(e.Request.Context(), backup.KindManual)
		if err != nil {
			if errors.Is(err, backup.ErrBusy) {
				return e.Error(http.StatusConflict, err.Error(), nil)
			}
			return e.InternalServerError("failed to create backup", err)
		}
		return e.JSON(http.StatusCreated, sum)
	}
}

func HandleDownloadBackup(app core.App, eng *backup.Engine) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if _, _, ok := backup.ParseFilename(id); !ok {
			return e.NotFoundError("backup not found", nil)
		}

		rc, size, err := eng.Open(e.Request.Context(), id)
		if err != nil {
			if errors.Is(err, backup.ErrNotFound) {
				return e.NotFoundError("backup not found", nil)
			}
			return e.InternalServerError("failed to open backup", err)
		}
		defer rc.Close()

		e.Response.Header().Set("Content-Type", "application/zip")
		e.Response.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		e.Response.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", id))

		return e.Stream(http.StatusOK, "application/zip", rc)
	}
}

var RestoreDelay = 1 * time.Second

func HandleRestoreBackup(app core.App, eng *backup.Engine) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if _, _, ok := backup.ParseFilename(id); !ok {
			return e.NotFoundError("backup not found", nil)
		}

		err := eng.Prepare(e.Request.Context(), id)
		if err != nil {
			if errors.Is(err, backup.ErrNotFound) {
				return e.NotFoundError("backup not found", nil)
			}
			if errors.Is(err, backup.ErrSchemaNewer) {
				return e.Error(http.StatusUnprocessableEntity, "App update required", nil)
			}
			if errors.Is(err, backup.ErrNotKalaidoBackup) {
				return e.BadRequestError("not a kalaido backup", nil)
			}
			if errors.Is(err, backup.ErrBusy) {
				return e.Error(http.StatusConflict, err.Error(), nil)
			}
			return e.InternalServerError("failed to prepare backup restore", err)
		}

		routine.FireAndForget(func() {
			if RestoreDelay > 0 {
				time.Sleep(RestoreDelay)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()

			if err := eng.Apply(ctx, id); err != nil {
				app.Logger().Error("backup restore failed", "error", err)
			}
		})

		return e.NoContent(http.StatusAccepted)
	}
}

func HandleDeleteBackup(app core.App, eng *backup.Engine) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if _, _, ok := backup.ParseFilename(id); !ok {
			return e.NotFoundError("backup not found", nil)
		}

		err := eng.Delete(e.Request.Context(), id)
		if err != nil {
			if errors.Is(err, backup.ErrNotFound) {
				return e.NotFoundError("backup not found", nil)
			}
			return e.InternalServerError("failed to delete backup", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

func HandleRestoreStatus(app core.App, eng *backup.Engine) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		outcome, err := eng.LastRestore()
		if err != nil {
			return e.InternalServerError("failed to read restore status", err)
		}
		return e.JSON(http.StatusOK, map[string]any{
			"boot_id":      eng.BootID(),
			"last_restore": outcome,
		})
	}
}
