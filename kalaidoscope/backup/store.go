package backup

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/tools/filesystem"
)

type localStore struct {
	dataDir func() string
}

func NewLocalStore(dataDir func() string) Store {
	return &localStore{
		dataDir: dataDir,
	}
}

func (s *localStore) backupsDir() string {
	return filepath.Join(s.dataDir(), "backups")
}

func (s *localStore) List(ctx context.Context) ([]Summary, error) {
	fsys, err := filesystem.NewLocal(s.backupsDir())
	if err != nil {
		return nil, err
	}
	defer fsys.Close()

	items, err := fsys.List("")
	if err != nil {
		return nil, err
	}

	var res []Summary
	for _, it := range items {
		kind, at, ok := ParseFilename(it.Key)
		if !ok {
			continue
		}
		res = append(res, Summary{
			ID:        it.Key,
			Kind:      kind,
			CreatedAt: at,
			SizeBytes: it.Size,
		})
	}

	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})
	return res, nil
}

func (s *localStore) Put(ctx context.Context, filename string) error {
	return nil
}

func (s *localStore) Fetch(ctx context.Context, filename string) error {
	fsys, err := filesystem.NewLocal(s.backupsDir())
	if err != nil {
		return err
	}
	defer fsys.Close()

	ok, _ := fsys.Exists(filename)
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *localStore) Open(ctx context.Context, filename string) (io.ReadCloser, int64, error) {
	fsys, err := filesystem.NewLocal(s.backupsDir())
	if err != nil {
		return nil, 0, err
	}
	defer fsys.Close()

	ok, _ := fsys.Exists(filename)
	if !ok {
		return nil, 0, ErrNotFound
	}

	attrs, err := fsys.Attributes(filename)
	if err != nil {
		return nil, 0, err
	}

	r, err := fsys.GetReader(filename)
	if err != nil {
		return nil, 0, err
	}

	return r, attrs.Size, nil
}

func (s *localStore) Delete(ctx context.Context, filename string) error {
	fsys, err := filesystem.NewLocal(s.backupsDir())
	if err != nil {
		return err
	}
	defer fsys.Close()

	ok, _ := fsys.Exists(filename)
	if !ok {
		return ErrNotFound
	}

	return fsys.Delete(filename)
}

type s3Store struct {
	dataDir func() string
	cfg     S3Config
	prefix  string
}

func NormalizePrefix(prefix string) string {
	return strings.TrimRight(prefix, "/") + "/"
}

func NewS3Store(dataDir func() string, cfg S3Config, prefix string) Store {
	return &s3Store{
		dataDir: dataDir,
		cfg:     cfg,
		prefix:  NormalizePrefix(prefix),
	}
}

func (s *s3Store) localPath(filename string) string {
	return filepath.Join(s.dataDir(), "backups", filename)
}

func (s *s3Store) key(filename string) string {
	return s.prefix + filename
}

func (s *s3Store) newFS() (*filesystem.System, error) {
	return filesystem.NewS3(
		s.cfg.Bucket,
		s.cfg.Region,
		s.cfg.Endpoint,
		s.cfg.AccessKey,
		s.cfg.Secret,
		s.cfg.ForcePathStyle,
	)
}

func (s *s3Store) List(ctx context.Context) ([]Summary, error) {
	fsys, err := s.newFS()
	if err != nil {
		return nil, err
	}
	defer fsys.Close()

	items, err := fsys.List(s.prefix)
	if err != nil {
		return nil, err
	}

	var res []Summary
	for _, it := range items {
		name := strings.TrimPrefix(it.Key, s.prefix)
		kind, at, ok := ParseFilename(name)
		if !ok {
			continue
		}
		res = append(res, Summary{
			ID:        name,
			Kind:      kind,
			CreatedAt: at,
			SizeBytes: it.Size,
		})
	}

	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})
	return res, nil
}

func (s *s3Store) Put(ctx context.Context, filename string) error {
	fsys, err := s.newFS()
	if err != nil {
		return err
	}
	defer fsys.Close()

	lp := s.localPath(filename)
	file, err := filesystem.NewFileFromPath(lp)
	if err != nil {
		return err
	}

	if err := fsys.UploadFile(file, s.key(filename)); err != nil {
		return err
	}

	return os.Remove(lp)
}

func (s *s3Store) Fetch(ctx context.Context, filename string) error {
	lp := s.localPath(filename)
	if _, err := os.Stat(lp); err == nil {
		return nil
	}

	fsys, err := s.newFS()
	if err != nil {
		return err
	}
	defer fsys.Close()

	key := s.key(filename)
	exists, err := fsys.Exists(key)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}

	r, err := fsys.GetReader(key)
	if err != nil {
		if errors.Is(err, filesystem.ErrNotFound) {
			return ErrNotFound
		}
		return err
	}
	defer r.Close()

	if err := os.MkdirAll(filepath.Dir(lp), 0o755); err != nil {
		return err
	}

	tmpPath := lp + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}

	_, copyErr := io.Copy(f, r)
	closeErr := f.Close()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return closeErr
	}

	if err := os.Rename(tmpPath, lp); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}

	return nil
}

func (s *s3Store) Open(ctx context.Context, filename string) (io.ReadCloser, int64, error) {
	fsys, err := s.newFS()
	if err != nil {
		return nil, 0, err
	}
	defer fsys.Close()

	key := s.key(filename)
	exists, err := fsys.Exists(key)
	if err != nil {
		return nil, 0, err
	}
	if !exists {
		return nil, 0, ErrNotFound
	}

	attrs, err := fsys.Attributes(key)
	if err != nil {
		if errors.Is(err, filesystem.ErrNotFound) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, err
	}

	r, err := fsys.GetReader(key)
	if err != nil {
		if errors.Is(err, filesystem.ErrNotFound) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, err
	}

	return r, attrs.Size, nil
}

func (s *s3Store) Delete(ctx context.Context, filename string) error {
	fsys, err := s.newFS()
	if err != nil {
		return err
	}
	defer fsys.Close()

	key := s.key(filename)
	exists, err := fsys.Exists(key)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}

	if err := fsys.Delete(key); err != nil {
		return err
	}

	err = os.Remove(s.localPath(filename))
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	return nil
}
