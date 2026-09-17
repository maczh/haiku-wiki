// Package errors 定义业务错误码与错误类型。
// code 约定：0 成功；40001 参数 / 40101 未登录 / 40301 无权限 / 40401 不存在 /
// 40901 冲突 / 41301 文件超限 / 41501 类型不允许 / 50000 服务器内部错误。
// HTTP 状态码与业务 code 同步。
package resp

import "fmt"

// AppError 携带业务 code 与 HTTP 状态码的错误。
type AppError struct {
	Code       int    // 业务错误码
	HTTPStatus int    // HTTP 状态码
	Message    string // 面向前端的提示
}

func (e *AppError) Error() string { return fmt.Sprintf("[%d] %s", e.Code, e.Message) }

// New 构造业务错误。
func New(code int, httpStatus int, message string) *AppError {
	return &AppError{Code: code, HTTPStatus: httpStatus, Message: message}
}

func Param(msg string) *AppError {
	if msg == "" {
		msg = "参数错误"
	}
	return New(40001, 400, msg)
}

func Unauthorized() *AppError { return New(40101, 401, "未登录或登录已失效") }
func Forbidden() *AppError    { return New(40301, 403, "没有访问权限") }
func NotFound(msg string) *AppError {
	if msg == "" {
		msg = "资源不存在"
	}
	return New(40401, 404, msg)
}
func Conflict(msg string) *AppError {
	if msg == "" {
		msg = "资源冲突"
	}
	return New(40901, 409, msg)
}
func FileTooLarge() *AppError       { return New(41301, 413, "文件超过 20MB 限制") }
func FileTypeNotAllowed() *AppError { return New(41501, 415, "不支持的文件类型") }

// TooManyRequests 请求过于频繁（限频），如分享密码校验 5 次/分钟。
func TooManyRequests(msg string) *AppError {
	if msg == "" {
		msg = "请求过于频繁，请稍后再试"
	}
	return New(42901, 429, msg)
}
func Internal(msg string) *AppError {
	if msg == "" {
		msg = "服务器内部错误"
	}
	return New(50000, 500, msg)
}
