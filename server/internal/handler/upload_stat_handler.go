package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// UploadStats GET /api/admin/upload-stats —— 内容去重统计（P1-4 / 管理端可观测）。
//
// 三项口径（与 repository.BumpUploadStat 的记账点一一对应）：
//   - total_uploads：新增 attachment meta 的次数（含秒传/引用式入库新增的行）
//   - dedup_hits：   其中「未写盘、复用已有物理对象」的次数
//   - saved_bytes：  因复用而省下的字节数
//
// 单行表（id=1），SeedData 时幂等建行；未建行时返回零值，不报错。
func UploadStats(c *gin.Context) {
	s, err := repository.GetUploadStat()
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{
		"total_uploads": s.TotalUploads,
		"dedup_hits":    s.DedupHits,
		"saved_bytes":   s.SavedBytes,
	})
}
