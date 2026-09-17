package handler

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"

	hkerr "haiku-wiki/server/internal/pkg"
)

// paramErr 参数绑定失败 → 40001。
func paramErr(err error) error {
	return hkerr.Param(fmt.Sprintf("参数错误: %v", err))
}

// paramMsg 直接构造参数错误。
func paramMsg(msg string) error {
	return hkerr.Param(msg)
}

// bookIDFromPath 解析 :id 路由参数为知识库 ID。
func bookIDFromPath(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	return id, err == nil && id > 0
}
