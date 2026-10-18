package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service/office"
)

var officeSlots = make(chan struct{}, 2)

func beginOfficeConversion(c *gin.Context) bool {
	select {
	case officeSlots <- struct{}{}:
		return true
	default:
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": 50301, "message": "Office 转换服务繁忙，请稍后重试"})
		return false
	}
}

// Stateless conversion accepts bytes only, never a storage path or remote URL.
// Public share readers use the same conversion contract without JWT. Access to
// source files and persisted snapshots remains governed by the existing APIs.
func OfficeCapabilities(c *gin.Context) {
	resp.OK(c, office.Default.Capabilities())
}

func OfficeImport(c *gin.Context) {
	if !beginOfficeConversion(c) {
		return
	}
	defer func() { <-officeSlots }()
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		resp.Error(c, paramMsg("Office 文件超过 16MB 或读取失败"))
		return
	}
	format := office.Format(strings.ToLower(c.Query("format")))
	out, err := office.Default.Import(c.Request.Context(), format, data)
	if err != nil {
		resp.Error(c, paramMsg(err.Error()))
		return
	}
	resp.OK(c, out)
}

func OfficeExport(c *gin.Context) {
	if !beginOfficeConversion(c) {
		return
	}
	defer func() { <-officeSlots }()
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
	var in struct {
		Format   office.Format   `json:"format"`
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramMsg("Office 快照无效或过大"))
		return
	}
	data, err := office.Default.Export(c.Request.Context(), in.Format, in.Snapshot)
	if err != nil {
		resp.Error(c, paramMsg(err.Error()))
		return
	}
	c.Header("Content-Disposition", `attachment; filename="document.`+string(in.Format)+`"`)
	c.Data(http.StatusOK, "application/octet-stream", data)
}
