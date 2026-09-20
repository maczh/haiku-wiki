package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// precheckMaxItems 批量预检单次上限（§12.2.1：`items` 超过 100 条 → 40001）。
//
// 前端按此粒度分批（`uploadFlow.ts`），后端只做硬校验，两端口径必须一致。
const precheckMaxItems = 100

// precheckItemReq 单个预检条目（单条形态与批量形态共用同一形状）。
type precheckItemReq struct {
	MD5      string `json:"md5"`
	Size     int64  `json:"size"`
	Filename string `json:"filename"`
}

// precheckReq POST /api/uploads/precheck 请求体（§3.3 R1 + §12.2.1 R1-ext）。
//
// 同一路由承载两种形态，**互斥**（同时给 `md5` 与 `items` → 40001）：
//
//	A) 单条：{md5,size,filename}            → data: {hit,md5,size}
//	B) 批量：{items:[{md5,size,filename},…]} → data: {results:[{index,hit,md5,size},…]}
//
// 形状对齐 §12.2.1，刻意不引入 `binding:"required"`：两种形态的必填项互斥，
// 用 gin 标签无法表达，改由 handler 显式判定后给出统一 40001 文案。
type precheckReq struct {
	MD5      string            `json:"md5"`
	Size     int64             `json:"size"`
	Filename string            `json:"filename"`
	Items    []precheckItemReq `json:"items"`
}

// precheckSingleResp 单条形态响应。
//
// ⚠️ 刻意**不含 `url`**（§12.0 修订）：URL 一律由入库接口（R2/R10/R11）返回。
// 预检只回「命中与否」，把跨库 URL 的暴露面收敛到她自己的上传流程里。
type precheckSingleResp struct {
	Hit  bool   `json:"hit"`
	MD5  string `json:"md5"`
	Size int64  `json:"size"`
}

// precheckBatchItemResp 批量形态的单条结果：`index` 保留**请求下标**，
// 前端据此把命中结果对回自己提交的条目（顺序敏感，不可按命中与否重排）。
type precheckBatchItemResp struct {
	Index int    `json:"index"`
	Hit   bool   `json:"hit"`
	MD5   string `json:"md5"`
	Size  int64  `json:"size"`
}

type precheckBatchResp struct {
	Results []precheckBatchItemResp `json:"results"`
}

// instantReq POST /api/uploads/instant 请求体（**无文件字节**，P0-2②）。
type instantReq struct {
	MD5      string `json:"md5"`
	Size     int64  `json:"size"`
	Filename string `json:"filename"`
	MIME     string `json:"mime"`
}

// isHexMD5Str 判断是否为 32 位**小写**十六进制 md5。
//
// ⚠️ 大写一律视为非法（→ 40001）：md5 的大小写敏感性是方言坑 —— MySQL 默认
// `utf8mb4_0900_ai_ci` 大小写不敏感、SQLite 文本主键默认 BINARY 敏感，若在此处
// 放过大写，同一个内容会在两种库上得到不同的去重行为。统一在入口只收小写，
// 与 `service.normalizeMD5` 的出口口径正好闭环（§13.3-②）。
func isHexMD5Str(s string) bool {
	if len(s) != 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			continue
		}
		return false
	}
	return true
}

// PrecheckUpload POST /api/uploads/precheck —— 秒传预检（JWT）。
//
// 无副作用：**不写 meta、不写盘、不计统计**（Q4）。整条路径只读 `attachments`，
// 批量形态逐条复用 `uploadService.Precheck`，保证单条/批量口径完全一致。
func PrecheckUpload(c *gin.Context) {
	var req precheckReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	// 互斥判定：`items != nil` 才能区分「传了空数组」与「没传 items 字段」。
	// 传了空数组 → 走批量分支的「items 不能为空」→ 40001（§12.2.1 明确要求）。
	hasSingle := strings.TrimSpace(req.MD5) != ""
	hasBatch := req.Items != nil
	if hasSingle && hasBatch {
		resp.Error(c, paramMsg("md5 与 items 只能二选一"))
		return
	}
	if hasBatch {
		precheckBatch(c, req.Items)
		return
	}
	precheckSingle(c, req)
}

// precheckSingle 处理单条预检形态。
func precheckSingle(c *gin.Context, req precheckReq) {
	if !isHexMD5Str(req.MD5) {
		resp.Error(c, paramMsg("md5 必须是 32 位小写十六进制"))
		return
	}
	if req.Size < 0 {
		resp.Error(c, paramMsg("size 不能为负数"))
		return
	}
	if req.Size > service.UploadMaxBytes() {
		resp.Error(c, resp.FileTooLarge())
		return
	}
	hit, err := uploadService.Precheck(req.MD5, req.Size, req.Filename)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, precheckSingleResp{Hit: hit, MD5: req.MD5, Size: req.Size})
}

// precheckBatch 处理批量预检形态。
//
// 错误优先级（§12.2.1）：**先做整批格式校验**（任一 md5/ size 非法 → 整批 40001），
// 再逐条做语义校验（白名单 → 41501、超限 → 41301）。这样「格式错」永远是整批结果，
// 不会因为遍历顺序不同而产生前后不一致的错误码。
func precheckBatch(c *gin.Context, items []precheckItemReq) {
	if len(items) == 0 {
		resp.Error(c, paramMsg("items 不能为空"))
		return
	}
	if len(items) > precheckMaxItems {
		resp.Error(c, paramMsg(fmt.Sprintf("items 最多 %d 条", precheckMaxItems)))
		return
	}
	for i, it := range items {
		if !isHexMD5Str(it.MD5) {
			resp.Error(c, paramMsg(fmt.Sprintf("items[%d].md5 必须是 32 位小写十六进制", i)))
			return
		}
		if it.Size < 0 {
			resp.Error(c, paramMsg(fmt.Sprintf("items[%d].size 不能为负数", i)))
			return
		}
	}

	results := make([]precheckBatchItemResp, 0, len(items))
	for i, it := range items {
		// 41301：与普通上传同口径（提前拦截，避免「预检通过但上传必失败」）。
		if it.Size > service.UploadMaxBytes() {
			resp.Error(c, resp.FileTooLarge())
			return
		}
		hit, err := uploadService.Precheck(it.MD5, it.Size, it.Filename)
		if err != nil {
			// 41501（扩展名不在白名单）等：沿用普通上传的错误码与文案。
			resp.Error(c, err)
			return
		}
		results = append(results, precheckBatchItemResp{
			Index: i,
			Hit:   hit,
			MD5:   it.MD5,
			Size:  it.Size,
		})
	}
	resp.OK(c, precheckBatchResp{Results: results})
}

// InstantUpload POST /api/uploads/instant —— 秒传落 meta（JWT，**请求体无文件字节**）。
//
// 响应与 `POST /api/uploads` 同构（`UploadOutput` 自带 md5/dedup），
// 前端两条路径可共用同一处理逻辑。错误码：
//   - 40401：md5 在 attachments 中不存在 → 前端自动降级为普通 multipart 上传
//   - 40901：md5 存在但 size 不一致 → 拒绝复用，降级普通上传
//   - 40001：md5 非 32 位小写 hex / size < 0
//   - 41501：扩展名不在白名单
//
// 越权说明：秒传只写 meta 行，目标文库的写权限由随后 createDoc / 文档级接口校验，
// 秒传本身不能越权写入他人文库（Q4）。
func InstantUpload(c *gin.Context) {
	var req instantReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if !isHexMD5Str(req.MD5) {
		resp.Error(c, paramMsg("md5 必须是 32 位小写十六进制"))
		return
	}
	if req.Size < 0 {
		resp.Error(c, paramMsg("size 不能为负数"))
		return
	}
	out, err := uploadService.Instant(middleware.UID(c), req.MD5, req.Filename, req.MIME, req.Size)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}
