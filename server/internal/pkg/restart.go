//go:build darwin || linux

// 通用工具（错误码、响应、重启）。本目录包名沿用历史命名为 resp，但按目录路径
// internal/pkg 导入并以别名 hkerr 引用，新增内容仍放此包。
package resp

import (
	"log"
	"os"
	"syscall"
	"time"
)

// Restart 延迟 delay 后在当前进程内原地重启（unix 上 re-exec 自身）。
//
// 用途：系统配置保存、迁移切换后让新配置生效。syscall.Exec 会用自身镜像替换当前
// 进程、关闭监听套接字，新进程按新配置重新绑定端口——对正在写入的请求是硬切换，
// 因此由调用方在「响应已返回前端」之后再触发（通常用 go Restart(...)）。
//
// 若 os.Executable / syscall.Exec 失败，则 os.Exit(0)，由 Docker / systemd 的
// restart 策略兜底把服务拉起（同样的配置），保证最终一致。
func Restart(delay time.Duration) {
	go func() {
		time.Sleep(delay)
		exe, err := os.Executable()
		if err != nil {
			log.Printf("[restart] 取自身可执行路径失败: %v", err)
			os.Exit(0)
			return
		}
		// syscall.Exec 成功时不返回；失败才返回，下方兜底退出。
		if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
			log.Printf("[restart] 重启失败: %v", err)
			os.Exit(0)
		}
	}()
}
