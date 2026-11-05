//go:build localdev

package static

import "io/fs"

// Dist 本地开发由 Vite 提供前端资源，不嵌入生产 dist。
func Dist() (fs.FS, error) { return nil, fs.ErrNotExist }

func HasIndex() bool { return false }
