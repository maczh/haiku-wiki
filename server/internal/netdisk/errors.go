package netdisk

import (
	"errors"
	"net/http"
	"strings"

	hkerr "haiku-wiki/server/internal/pkg"
)

// 错误码段 42xxx（设计文档 §8.4）。集中在这一处定义，避免各处硬编码。
//
// 其余沿用 pkg/errors.go：Param=40001 / Unauthorized=40101 / Forbidden=40301 / NotFound=40401。
const (
	CodeConfigInvalid   = 42001 // 连接配置无效
	CodeConnectFailed   = 42002 // 网盘连接失败（主机不可达 / 超时 / share 不存在）
	CodeAuthFailed      = 42003 // 网盘认证失败
	CodePathNotFound    = 42004 // 路径不存在
	CodeAlreadyExists   = 42005 // 目标已存在
	CodeKindDisabled    = 42006 // 网盘类型未启用（provider 未配置）
	CodeLimitExceeded   = 42007 // 超限（文件过大 / 连接数达上限）
	CodeUnsupported     = 42008 // 不支持的操作（FTP 主动模式等）
	CodeReauthRequired  = 42009 // 需要重新授权
	CodeRateLimited     = 42010 // 网盘侧限流 / 配额
	CodeTaskInvalid     = 42011 // 任务不可操作
	CodePreviewTokenBad = 42012 // 预览 token 无效或过期
)

// 各码对应的 HTTP 状态码（与业务码同步，前端靠 body.code 分支）。
const (
	HTTPConfigInvalid   = http.StatusBadRequest
	HTTPConnectFailed   = http.StatusBadGateway
	HTTPAuthFailed      = http.StatusUnauthorized
	HTTPPathNotFound    = http.StatusNotFound
	HTTPAlreadyExists   = http.StatusConflict
	HTTPKindDisabled    = http.StatusBadRequest
	HTTPLimitExceeded   = http.StatusRequestEntityTooLarge
	HTTPUnsupported     = http.StatusBadRequest
	HTTPReauthRequired  = http.StatusUnauthorized
	HTTPRateLimited     = http.StatusTooManyRequests
	HTTPTaskInvalid     = http.StatusBadRequest
	HTTPPreviewTokenBad = http.StatusUnauthorized
)

// ErrRangeUnsupported 驱动不支持分段读（上层退化为全量 Open）。
var ErrRangeUnsupported = hkerr.New(CodeUnsupported, HTTPUnsupported, "该网盘不支持分段读取")

// ErrRecursiveRemoveUnsupported 驱动不支持递归删目录。
var ErrRecursiveRemoveUnsupported = hkerr.New(CodeUnsupported, HTTPUnsupported, "该网盘不支持递归删除目录")

// ErrReauthRequired OAuth token 刷新失败，需要用户重新授权。
var ErrReauthRequired = hkerr.New(CodeReauthRequired, HTTPReauthRequired, "授权已失效，请重新授权")

// ---------- 构造器（统一走这里，避免各处手写 code 漂移） ----------

// ConfigInvalid 连接配置无效（42001）。
func ConfigInvalid(msg string) error {
	if msg == "" {
		msg = "连接配置无效"
	}
	return hkerr.New(CodeConfigInvalid, HTTPConfigInvalid, msg)
}

// ConnectFailed 网盘连接失败（42002）。
func ConnectFailed(msg string) error {
	if msg == "" {
		msg = "无法连接到网盘"
	}
	return hkerr.New(CodeConnectFailed, HTTPConnectFailed, msg)
}

// AuthFailed 网盘认证失败（42003）。
func AuthFailed(msg string) error {
	if msg == "" {
		msg = "认证失败，请检查用户名或密码"
	}
	return hkerr.New(CodeAuthFailed, HTTPAuthFailed, msg)
}

// PathNotFound 路径不存在（42004）。
func PathNotFound(msg string) error {
	if msg == "" {
		msg = "文件或目录不存在"
	}
	return hkerr.New(CodePathNotFound, HTTPPathNotFound, msg)
}

// AlreadyExists 目标已存在（42005）。
func AlreadyExists(msg string) error {
	if msg == "" {
		msg = "同名文件或目录已存在"
	}
	return hkerr.New(CodeAlreadyExists, HTTPAlreadyExists, msg)
}

// KindDisabled 网盘类型未启用（42006）。
func KindDisabled(msg string) error {
	if msg == "" {
		msg = "该网盘类型未启用（缺少服务端配置）"
	}
	return hkerr.New(CodeKindDisabled, HTTPKindDisabled, msg)
}

// LimitExceeded 超限（42007）。
func LimitExceeded(msg string) error {
	if msg == "" {
		msg = "超出系统限制"
	}
	return hkerr.New(CodeLimitExceeded, HTTPLimitExceeded, msg)
}

// Unsupported 不支持的操作（42008）。
func Unsupported(msg string) error {
	if msg == "" {
		msg = "不支持的操作"
	}
	return hkerr.New(CodeUnsupported, HTTPUnsupported, msg)
}

// RateLimited 网盘侧限流 / 配额（42010）。
func RateLimited(msg string) error {
	if msg == "" {
		msg = "网盘侧限流或配额不足，请稍后重试"
	}
	return hkerr.New(CodeRateLimited, HTTPRateLimited, msg)
}

// TaskInvalid 任务不可操作（42011）。
func TaskInvalid(msg string) error {
	if msg == "" {
		msg = "任务不存在或当前状态不允许该操作"
	}
	return hkerr.New(CodeTaskInvalid, HTTPTaskInvalid, msg)
}

// BadPreviewToken 预览 token 无效或过期（42012）。
func BadPreviewToken(msg string) error {
	if msg == "" {
		msg = "预览链接无效或已过期"
	}
	return hkerr.New(CodePreviewTokenBad, HTTPPreviewTokenBad, msg)
}

// ---------- 各协议 / 平台原始错误 → 统一 AppError ----------

// IsAppError 判断 err 是否已经是业务错误（避免二次包装丢掉原始码）。
func IsAppError(err error) bool {
	var ae *hkerr.AppError
	return errors.As(err, &ae)
}

// MapError 把驱动返回的原始错误翻译成统一业务错误。
//
// 已经带业务码的错误原样返回（驱动内部通常已经判过），其余按文案做保守归类：
// 网络类 → 42002，认证类 → 42003，不存在 → 42004，重名 → 42005。
// 归类失败时回落到 42002（连接失败）—— 网盘侧的绝大多数意外都是连通性问题。
func MapError(err error) error {
	if err == nil {
		return nil
	}
	if IsAppError(err) {
		return err
	}
	msg := err.Error()
	low := strings.ToLower(msg)

	switch {
	case containsAny(low, "no such file", "not found", "no such directory", "550", "不存在"):
		return PathNotFound(msg)
	case containsAny(low, "already exists", "exists", "conflict", "已存在"):
		return AlreadyExists(msg)
	case containsAny(low, "authentication", "auth failed", "login", "password", "access denied",
		"permission denied", "530", "uname", "认证", "权限"):
		return AuthFailed(msg)
	case containsAny(low, "refused", "timeout", "deadline exceeded", "no route", "unreachable",
		"connection reset", "connection closed", "i/o timeout", "dial tcp", "不可达", "超时"):
		return ConnectFailed(msg)
	case containsAny(low, "unsupported", "not supported"):
		return Unsupported(msg)
	default:
		return ConnectFailed(msg)
	}
}

// containsAny 子串命中判定（MapError 的文案归类用）。
func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// ---------- 百度网盘 ----------

// MapBaiduError 百度网盘开放平台 errno → 业务错误。
//
// 常见码：
//   - 20011 用户数超限（应用未上线审核时最多 10 个用户）
//   - 20012 超频（接口调用频率超限）
//   - 20013 无权限（scope 不足或目录越界）
//   - 31066 文件不存在；31034 命中限速
func MapBaiduError(errno int, msg string) error {
	switch errno {
	case 0:
		return nil
	case 20011:
		return RateLimited("百度网盘：当前应用可服务用户数已达上限（未通过上线审核时为 10 人）")
	case 20012:
		return RateLimited("百度网盘：接口调用频率超限，请稍后重试")
	case 20013:
		return AuthFailed("百度网盘：无权限访问该目录（应用只能访问 /apps/" + baiduAppNameForMsg() + " 下的数据）")
	case 31034:
		return RateLimited("百度网盘：操作过于频繁，请稍后重试")
	case 31066:
		return PathNotFound("百度网盘：文件不存在或已被删除")
	case -6, 10, 111:
		// -6 身份校验失败 / 10 权限不足 / 111 access_token 无效
		return hkerr.New(CodeReauthRequired, HTTPReauthRequired, "百度网盘授权已失效，请重新授权")
	case 2, 31023:
		return AuthFailed("百度网盘：参数错误或权限不足")
	default:
		if msg == "" {
			msg = "百度网盘接口错误"
		}
		return RateLimited(msg)
	}
}

// baiduAppNameForMsg 错误文案里展示的应用目录名（避免把 Baidu 包级配置硬编码进文案）。
func baiduAppNameForMsg() string {
	if n := strings.TrimSpace(CurrentConfig().BaiduAppName); n != "" {
		return n
	}
	return "haiku-wiki"
}

// ---------- 阿里云盘 ----------

// MapAliyunError 阿里云盘 HTTP 状态码 + code → 业务错误。
//
// 403 在阿里云盘里最常见的是「当前下载并发已达上限」（未购三方应用权益包时更严格），
// 也有权限不足的情况，这里统一按限流处理并给出可操作文案。
func MapAliyunError(status int, code, msg string) error {
	if status == 0 {
		return nil
	}
	switch status {
	case 401, 403:
		if code == "Forbidden" || code == "PermissionDenied" {
			return AuthFailed("阿里云盘：权限不足，请检查应用授权范围")
		}
		// 阿里云盘 403 的最常见语义：下载并发超限（权益包未开通时为标准通道 + 更严限制）
		return RateLimited("阿里云盘：当前下载并发已达上限，请稍后重试")
	case 404:
		return PathNotFound("阿里云盘：文件不存在或已被删除")
	case 429:
		return RateLimited("阿里云盘：请求过于频繁，请稍后重试")
	default:
		if msg == "" {
			msg = "阿里云盘接口错误"
		}
		if status >= 500 {
			return ConnectFailed(msg)
		}
		return RateLimited(msg)
	}
}

// ---------- FTP ----------

// ErrFTPActiveMode FTP 主动模式（PORT）本期不实现（设计文档 §1.5）。
//
// 事实：Go 生态主流 FTP 客户端库（jlaffaye/ftp v0.2.4、secsy/goftp）均不支持主动模式，
// 要实现必须 fork 并自行处理 PORT 命令 + 客户端侧监听 socket + NAT 穿透。
// 且主动模式在「浏览器 → 后端服务 → FTP 服务端」三段链路里要求服务端反向连回部署机，
// 云主机 / NAT 环境几乎不可用。故 UI 保留选项但置灰，后端直接拒绝。
func ErrFTPActiveMode() error {
	return Unsupported("当前版本仅支持被动模式（PASV/EPSV）。主动模式需服务端反向连回，在 NAT/防火墙环境下基本不可用，将在后续版本支持")
}
