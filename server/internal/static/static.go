// Package static 以 embed 方式托管前端构建产物（生产模式单容器部署）。
// 本地开发时 dist 目录仅有占位文件，HasIndex() 返回 false，前端走 Vite dev server。
package static

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Dist 返回 dist 子文件系统。
func Dist() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}

// HasIndex 判断是否嵌入了前端产物（index.html 是否存在）。
func HasIndex() bool {
	f, err := distFS.Open("dist/index.html")
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}
