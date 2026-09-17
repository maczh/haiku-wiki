// Package resp 统一 HTTP 响应封装：{"code":0,"message":"ok","data":...}。
package resp

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

type body struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
}

// OK 成功响应。
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, body{Code: 0, Message: "ok", Data: data})
}

// Fail 以指定错误码响应。
func Fail(c *gin.Context, code int, httpStatus int, message string) {
	c.JSON(httpStatus, body{Code: code, Message: message})
}

// Error 将 error 映射为统一响应：AppError 用其自带 code，其余按 50000 处理。
func Error(c *gin.Context, err error) {
	var ae *AppError
	if errors.As(err, &ae) {
		Fail(c, ae.Code, ae.HTTPStatus, ae.Message)
		return
	}
	log.Printf("[resp] internal error: %v", err)
	Fail(c, 50000, http.StatusInternalServerError, "服务器内部错误")
}
