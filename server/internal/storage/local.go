package storage

import (
	"io"
	"os"
	"path/filepath"
	"time"

	"haiku-wiki/server/internal/config"
	hkerr "haiku-wiki/server/internal/pkg"
)

// localStore 本地文件系统后端：key 直接映射到 <root>/<key>。
type localStore struct {
	root string
}

// NewLocal 构造本地后端（root 为数据目录，如 /app/data）。
func NewLocal(root string) (Store, error) {
	abs := root
	if abs == "" {
		abs = "./data"
	}
	if ad, err := filepath.Abs(abs); err == nil {
		abs = ad
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, hkerr.Internal("创建数据目录失败: " + abs)
	}
	return &localStore{root: abs}, nil
}

func (s *localStore) Kind() string { return config.StorageLocal }

// abs key → 绝对路径，并二次校验不出 root（safeKey 已拦 ..，这里再兜一道）。
func (s *localStore) abs(key string) (string, error) {
	k, err := safeKey(key)
	if err != nil {
		return "", err
	}
	p := filepath.Join(s.root, filepath.FromSlash(k))
	// 走出 root 说明 key 有问题（软链接等），一律拒绝
	if rel, err := filepath.Rel(s.root, p); err != nil || rel == ".." ||
		(len(rel) > 2 && rel[:3] == "../") {
		return "", hkerr.Param("存储键无效")
	}
	return p, nil
}

func (s *localStore) Put(key string, data []byte, contentType string) error {
	p, err := s.abs(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return hkerr.Internal("创建存储目录失败")
	}
	// 先写临时文件再 rename：避免写入中途失败留下半截文件被别处读到。
	tmp, err := os.CreateTemp(filepath.Dir(p), ".put-*.tmp")
	if err != nil {
		return hkerr.Internal("创建临时文件失败")
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		_ = os.Remove(tmpName)
		return hkerr.Internal("写入文件失败")
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return hkerr.Internal("写入文件失败")
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		_ = err
	}
	if err := os.Rename(tmpName, p); err != nil {
		_ = os.Remove(tmpName)
		return hkerr.Internal("写入文件失败")
	}
	return nil
}

func (s *localStore) Read(key string) ([]byte, error) {
	p, err := s.abs(key)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, hkerr.NotFound("文件不存在")
		}
		return nil, hkerr.Internal("读取文件失败")
	}
	return b, nil
}

func (s *localStore) Open(key string) (io.ReadCloser, error) {
	p, err := s.abs(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, hkerr.NotFound("文件不存在")
		}
		return nil, hkerr.Internal("读取文件失败")
	}
	return f, nil
}

func (s *localStore) Delete(key string) error {
	p, err := s.abs(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return hkerr.Internal("删除文件失败")
	}
	return nil
}

func (s *localStore) Exists(key string) (bool, error) {
	p, err := s.abs(key)
	if err != nil {
		return false, err
	}
	st, err := os.Stat(p)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, hkerr.Internal("检查文件失败")
	}
	return !st.IsDir(), nil
}

// List 遍历目录树（跳过临时文件与目录）。
func (s *localStore) List(prefix string) ([]Info, error) {
	p := listPrefix(prefix) // 空前缀 = 从 root 开始列全部
	root := s.root
	if p != "" {
		root = filepath.Join(root, filepath.FromSlash(p))
	}
	var out []Info
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // 单文件读不到不影响整体列举（迁移时更稳健）
		}
		if info.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(s.root, path)
		if rerr != nil {
			return nil
		}
		out = append(out, Info{
			Key:      filepath.ToSlash(rel),
			Size:     info.Size(),
			Modified: info.ModTime(),
		})
		return nil
	})
	if err != nil {
		return nil, hkerr.Internal("遍历目录失败")
	}
	return out, nil
}

func (s *localStore) URL(key string) string { return URLFromKey(key) }

// LocalPath 本地后端直接给真实路径，cleanup 为空操作（调用方无条件 defer 即可）。
func (s *localStore) LocalPath(key string) (string, func(), error) {
	p, err := s.abs(key)
	if err != nil {
		return "", func() {}, err
	}
	if _, err := os.Stat(p); err != nil {
		if os.IsNotExist(err) {
			return "", func() {}, hkerr.NotFound("文件不存在")
		}
		return "", func() {}, hkerr.Internal("读取文件失败")
	}
	return p, func() {}, nil
}

// 编译期接口断言
var _ Store = (*localStore)(nil)
var _ = time.Now
