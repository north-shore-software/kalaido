package backup

import (
	"context"
	"errors"
	"io"
	"path/filepath"
	"sort"

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

type s3Store struct{}

func NewS3Store(dataDir func() string, cfg S3Config, prefix string) Store {
	return &s3Store{}
}

var errS3NotImplemented = errors.New("backup: s3 store not implemented")

func (s *s3Store) List(ctx context.Context) ([]Summary, error) {
	return nil, errS3NotImplemented
}

func (s *s3Store) Put(ctx context.Context, filename string) error {
	return errS3NotImplemented
}

func (s *s3Store) Fetch(ctx context.Context, filename string) error {
	return errS3NotImplemented
}

func (s *s3Store) Open(ctx context.Context, filename string) (io.ReadCloser, int64, error) {
	return nil, 0, errS3NotImplemented
}

func (s *s3Store) Delete(ctx context.Context, filename string) error {
	return errS3NotImplemented
}
