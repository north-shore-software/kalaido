package backup

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/archive"
	"github.com/pocketbase/pocketbase/tools/osutils"
	"github.com/pocketbase/pocketbase/tools/security"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

type Kind string

const (
	KindManual     Kind = "manual"
	KindScheduled  Kind = "scheduled"
	KindPreRestore Kind = "pre-restore"
)

type Summary struct {
	ID        string    `json:"id"`
	Kind      Kind      `json:"kind"`
	CreatedAt time.Time `json:"created_at"`
	SizeBytes int64     `json:"size_bytes"`
}

type Manifest struct {
	Version       int       `json:"version"`
	SchemaVersion int       `json:"schema_version"`
	BuildRev      string    `json:"build_rev"`
	ScopeID       string    `json:"scope_id"`
	CreatedAt     time.Time `json:"created_at"`
	Origin        string    `json:"origin"`
	Kind          Kind      `json:"kind"`
}

const ManifestName = "backup-manifest.json"

const timeLayout = "20060102T150405Z"

type Store interface {
	List(ctx context.Context) ([]Summary, error)
	Put(ctx context.Context, filename string) error
	Fetch(ctx context.Context, filename string) error
	Open(ctx context.Context, filename string) (io.ReadCloser, int64, error)
	Delete(ctx context.Context, filename string) error
}

type S3Config struct {
	Bucket, Region, Endpoint, AccessKey, Secret string
	ForcePathStyle                              bool
}

type Lifecycle struct {
	BeforeSwap func() error
	Restart    func() error
	Recover    func()
}

type Options struct {
	ScopeID   string
	Origin    string
	Lifecycle Lifecycle
	Store     Store
}

type Engine struct {
	app   core.App
	store Store
	opts  Options
}

var (
	ErrNotFound         = errors.New("backup: not found")
	ErrSchemaNewer      = errors.New("backup: archive schema is newer than this build")
	ErrNotKalaidoBackup = errors.New("backup: archive has no manifest")
	ErrBusy             = errors.New("backup: another backup or restore is running")
)

func New(app core.App, store Store, opts Options) *Engine {
	return &Engine{
		app:   app,
		store: store,
		opts:  opts,
	}
}

func Filename(kind Kind, at time.Time) string {
	return fmt.Sprintf("%s-%s.zip", kind, at.UTC().Format(timeLayout))
}

func ParseFilename(name string) (Kind, time.Time, bool) {
	if strings.ContainsAny(name, `/\`) {
		return "", time.Time{}, false
	}
	if !strings.HasSuffix(name, ".zip") {
		return "", time.Time{}, false
	}
	base := strings.TrimSuffix(name, ".zip")

	var k Kind
	var rest string
	switch {
	case strings.HasPrefix(base, "manual-"):
		k = KindManual
		rest = strings.TrimPrefix(base, "manual-")
	case strings.HasPrefix(base, "scheduled-"):
		k = KindScheduled
		rest = strings.TrimPrefix(base, "scheduled-")
	case strings.HasPrefix(base, "pre-restore-"):
		k = KindPreRestore
		rest = strings.TrimPrefix(base, "pre-restore-")
	default:
		return "", time.Time{}, false
	}

	if len(rest) != 16 {
		return "", time.Time{}, false
	}

	t, err := time.Parse(timeLayout, rest)
	if err != nil {
		return "", time.Time{}, false
	}

	return k, t.UTC(), true
}

func ReadManifest(zipPath string) (*Manifest, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	var mf *zip.File
	for _, f := range r.File {
		if f.Name == ManifestName {
			mf = f
			break
		}
	}
	if mf == nil {
		return nil, ErrNotKalaidoBackup
	}

	rc, err := mf.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	var m Manifest
	if err := json.NewDecoder(rc).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (e *Engine) List(ctx context.Context) ([]Summary, error) {
	sums, err := e.store.List(ctx)
	if err != nil {
		return nil, err
	}
	sort.Slice(sums, func(i, j int) bool {
		return sums[i].CreatedAt.After(sums[j].CreatedAt)
	})
	return sums, nil
}

func (e *Engine) Create(ctx context.Context, kind Kind) (Summary, error) {
	now := time.Now().UTC()
	filename := Filename(kind, now)

	if err := e.app.CreateBackup(ctx, filename); err != nil {
		if strings.Contains(err.Error(), "another backup/restore operation") {
			return Summary{}, ErrBusy
		}
		return Summary{}, err
	}

	backupsDir := filepath.Join(e.app.DataDir(), "backups")
	origPath := filepath.Join(backupsDir, filename)
	tmpPath := filepath.Join(backupsDir, filename+".tmp")

	if err := rewriteArchiveWithManifest(origPath, tmpPath, Manifest{
		Version:       1,
		SchemaVersion: schema.Version,
		BuildRev:      schema.BuildRevision(),
		ScopeID:       e.opts.ScopeID,
		CreatedAt:     now,
		Origin:        e.opts.Origin,
		Kind:          kind,
	}); err != nil {
		_ = os.Remove(tmpPath)
		return Summary{}, err
	}

	if err := os.Rename(tmpPath, origPath); err != nil {
		_ = os.Remove(tmpPath)
		return Summary{}, err
	}

	_ = os.Remove(origPath + ".attrs")

	fi, err := os.Stat(origPath)
	if err != nil {
		return Summary{}, err
	}

	if err := e.store.Put(ctx, filename); err != nil {
		return Summary{}, err
	}

	_, at, _ := ParseFilename(filename)
	return Summary{
		ID:        filename,
		Kind:      kind,
		CreatedAt: at,
		SizeBytes: fi.Size(),
	}, nil
}

func rewriteArchiveWithManifest(origPath, tmpPath string, m Manifest) error {
	zr, err := zip.OpenReader(origPath)
	if err != nil {
		return err
	}
	defer zr.Close()

	zf, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer zf.Close()

	zw := zip.NewWriter(zf)

	for _, f := range zr.File {
		if err := zw.Copy(f); err != nil {
			_ = zw.Close()
			return err
		}
	}

	mData, err := json.Marshal(m)
	if err != nil {
		_ = zw.Close()
		return err
	}

	mw, err := zw.CreateHeader(&zip.FileHeader{
		Name:     ManifestName,
		Method:   zip.Deflate,
		Modified: m.CreatedAt,
	})
	if err != nil {
		_ = zw.Close()
		return err
	}

	if _, err := mw.Write(mData); err != nil {
		_ = zw.Close()
		return err
	}

	if err := zw.Close(); err != nil {
		return err
	}

	return zf.Close()
}

func (e *Engine) Prepare(ctx context.Context, id string) error {
	if err := e.store.Fetch(ctx, id); err != nil {
		return err
	}

	m, err := ReadManifest(filepath.Join(e.app.DataDir(), "backups", id))
	if err != nil {
		return err
	}

	if m.SchemaVersion > schema.Version {
		return ErrSchemaNewer
	}

	_, err = e.Create(ctx, KindPreRestore)
	return err
}

func (e *Engine) Apply(ctx context.Context, id string) error {
	if e.app.Store().Has(core.StoreKeyActiveBackup) {
		return ErrBusy
	}
	e.app.Store().Set(core.StoreKeyActiveBackup, id)
	defer e.app.Store().Remove(core.StoreKeyActiveBackup)

	dataDir := e.app.DataDir()
	tempDir := filepath.Join(dataDir, core.LocalTempDirName)
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		return err
	}

	staging := filepath.Join(tempDir, "restore_"+security.PseudorandomString(8))
	defer os.RemoveAll(staging)

	if err := archive.Extract(filepath.Join(dataDir, "backups", id), staging); err != nil {
		return err
	}

	if _, err := os.Stat(filepath.Join(staging, "data.db")); err != nil {
		return err
	}

	_ = os.Remove(filepath.Join(staging, ManifestName))

	if e.opts.Lifecycle.BeforeSwap != nil {
		if err := e.opts.Lifecycle.BeforeSwap(); err != nil {
			return err
		}
	}

	old := filepath.Join(tempDir, "old_"+security.PseudorandomString(8))

	swapErr := e.app.RunInTransaction(func(txApp core.App) error {
		return txApp.AuxRunInTransaction(func(txApp core.App) error {
			if err := osutils.MoveDirContent(dataDir, old, core.LocalBackupsDirName, core.LocalTempDirName); err != nil {
				return err
			}
			if err := osutils.MoveDirContent(staging, dataDir, core.LocalBackupsDirName, core.LocalTempDirName); err != nil {
				return err
			}
			return nil
		})
	})

	if swapErr != nil {
		revertErr := e.app.RunInTransaction(func(txApp core.App) error {
			return txApp.AuxRunInTransaction(func(txApp core.App) error {
				if err := osutils.MoveDirContent(dataDir, staging, core.LocalBackupsDirName, core.LocalTempDirName); err != nil {
					return err
				}
				if err := osutils.MoveDirContent(old, dataDir, core.LocalBackupsDirName, core.LocalTempDirName); err != nil {
					return err
				}
				return nil
			})
		})

		retErr := swapErr
		if revertErr != nil {
			retErr = errors.Join(swapErr, revertErr)
		}

		if e.opts.Lifecycle.Recover != nil {
			e.opts.Lifecycle.Recover()
		}

		return retErr
	}

	if e.opts.Lifecycle.Restart != nil {
		return e.opts.Lifecycle.Restart()
	}

	return nil
}

func (e *Engine) Open(ctx context.Context, id string) (io.ReadCloser, int64, error) {
	return e.store.Open(ctx, id)
}

func (e *Engine) Delete(ctx context.Context, id string) error {
	return e.store.Delete(ctx, id)
}

func Install(app core.App, eng *Engine) {
	app.OnBackupCreate().BindFunc(func(e *core.BackupEvent) error {
		e.Exclude = append(e.Exclude, "schema-migration-failed.json")
		return e.Next()
	})
}
