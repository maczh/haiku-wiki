package handler

import (
	"encoding/json"
	"mime/multipart"
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// PrototypeAddItems POST /api/docs/:id/prototype/items —— 往原型库批量加原型。
//
// 与图片库不同，每个原型文件都必须带「标题」（必填）与「需求描述」（可选），
// 否则两周后没人看得懂这份原型在说明什么。用并列的表单字段传递：
//   - files[] ：原型文件（Axure/.mp/.sketch/html/zip/图片）
//   - titles[]：与提交条目**等长同序**的标题数组（JSON 字符串）
//   - descs[] ：与提交条目**等长同序**的需求描述数组（JSON 字符串，可空）
//
// 后端逐张处理：能渲染的（html/图片）就地展示，专有格式（.rp/.mp/.sketch）保原件下载 +
// 尽量抽预览图，整批不因单张失败而作废（rejected 给出逐条原因）。
//
// 两阶段协议（T03b，§12.2.3）：可选字段 `manifest`（JSON 数组，**唯一真源**）声明与
// 用户所选条目等长同序的条目列表，`files[]` 只承载其中 `kind=file` 的字节。
// **`titles`/`descs` 一律按 manifest 下标对齐**（§12.5）—— 这样被秒传的条目也能拿到
// 它自己的标题，而不会串到相邻条目上。无 `manifest` 时退化为改造前的纯字节契约。
func PrototypeAddItems(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	form, err := c.MultipartForm()
	if err != nil {
		resp.Error(c, paramMsg("请上传原型文件"))
		return
	}
	fhs := form.File["files"]
	manifest, err := parseManifest(firstFormValue(form.Value["manifest"]), len(fhs))
	if err != nil {
		resp.Error(c, err)
		return
	}
	if manifest == nil && len(fhs) == 0 {
		resp.Error(c, paramMsg("请上传原型文件"))
		return
	}
	// 标题/描述的对齐基准：有 manifest 取 len(manifest)，否则取 len(fhs)。
	metaLen := len(fhs)
	if manifest != nil {
		metaLen = len(manifest)
	}
	titles, descs := parsePrototypeMeta(form.Value["titles"], form.Value["descs"], metaLen)

	lim := service.PrototypeMaxBytes()
	files := make([]service.PrototypeUpload, 0, metaLen)
	rejected := make([]service.PrototypeReject, 0)
	if manifest == nil {
		for i, fh := range fhs {
			data, reason := readBytesUpload(fh, lim)
			if reason != "" {
				rejected = append(rejected, service.PrototypeReject{Name: fh.Filename, Reason: reason})
				continue
			}
			files = append(files, service.PrototypeUpload{
				Name:  fh.Filename,
				Data:  data,
				Title: at(titles, i),
				Desc:  at(descs, i),
			})
		}
	} else {
		files = append(files, prototypeEntries(fhs, manifest, titles, descs, lim, &rejected)...)
	}

	added, rej, err := docService.AddPrototypeItems(middleware.UID(c), id, files)
	if err != nil {
		resp.Error(c, err)
		return
	}
	rejected = append(rejected, rej...)
	resp.OK(c, gin.H{
		"items":    added,
		"rejected": rejected,
		"mode":     batchMode(manifest),
		"summary":  summarize(manifest, len(fhs), countPrototypeExpired(rejected), countPrototypeWritten(added)),
	})
}

// countPrototypeWritten 统计本次**真正写盘**的入库条目数（= 新写 CAS 对象数，§12.2.3）。
func countPrototypeWritten(items []service.PrototypeItem) int {
	n := 0
	for _, it := range items {
		if !it.Dedup {
			n++
		}
	}
	return n
}

// countPrototypeExpired 统计因「引用结果已过期」被拒的条数（reason 为固定文案，§12.2.2）。
func countPrototypeExpired(rejected []service.PrototypeReject) int {
	n := 0
	for _, r := range rejected {
		if r.Reason == service.ReferenceExpiredReason {
			n++
		}
	}
	return n
}

// prototypeEntries 按 manifest（唯一真源）组装有序条目。
//
// `titles`/`descs` 按 **manifest 下标**取值（§12.5）—— 被秒传的条目（kind=ref）也
// 因此能拿到自己的标题；`kind=file` 则依 manifest 中的出现顺序消费 `fhs`（字节游标）。
func prototypeEntries(fhs []*multipart.FileHeader, manifest []BatchManifestEntry, titles, descs []string, lim int64, rejected *[]service.PrototypeReject) []service.PrototypeUpload {
	out := make([]service.PrototypeUpload, 0, len(manifest))
	fi := 0
	for i, m := range manifest {
		if m.Kind == "ref" {
			out = append(out, service.PrototypeUpload{
				Name:  m.Name,
				Kind:  service.BatchKindRef,
				MD5:   m.MD5,
				Size:  m.Size,
				Title: at(titles, i),
				Desc:  at(descs, i),
			})
			continue
		}
		if fi >= len(fhs) {
			break // 已被 parseManifest 的计数校验挡下；此处仅为防越界兜底
		}
		fh := fhs[fi]
		fi++
		data, reason := readBytesUpload(fh, lim)
		if reason != "" {
			*rejected = append(*rejected, service.PrototypeReject{Name: m.Name, Reason: reason})
			continue
		}
		logManifestMismatch("prototype", m, fh)
		out = append(out, service.PrototypeUpload{
			Name:  m.Name,
			Data:  data,
			Kind:  service.BatchKindFile,
			Title: at(titles, i),
			Desc:  at(descs, i),
		})
	}
	return out
}

// at 安全取下标（越界返回空串）——标题/描述数组可能短于条目数。
func at(xs []string, i int) string {
	if i >= 0 && i < len(xs) {
		return xs[i]
	}
	return ""
}

// PrototypeUpdateItem PATCH /api/docs/:id/prototype/items/:itemId —— 改某条原型的标题与需求描述。
func PrototypeUpdateItem(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	var in struct {
		Title string `json:"title"`
		Desc  string `json:"desc"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if err := docService.UpdatePrototypeItem(middleware.UID(c), id, c.Param("itemId"), in.Title, in.Desc); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"title": in.Title, "desc": in.Desc})
}

// PrototypeRemoveItem DELETE /api/docs/:id/prototype/items/:itemId —— 删一条原型（原件/预览图/网页包一并清理）。
func PrototypeRemoveItem(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	itemID := c.Param("itemId")
	if itemID == "" {
		resp.Error(c, paramMsg("原型 ID 无效"))
		return
	}
	if err := docService.RemovePrototypeItem(middleware.UID(c), id, itemID); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"item_id": itemID})
}

// PrototypeRegenerateItem POST /api/docs/:id/prototype/items/:itemId/regenerate
// 重新生成某条原型的预览图（三档），用于首次转换降级/缺转换器后的补救。
func PrototypeRegenerateItem(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	itemID := c.Param("itemId")
	if itemID == "" {
		resp.Error(c, paramMsg("原型 ID 无效"))
		return
	}
	it, err := docService.RegeneratePrototypeItem(middleware.UID(c), id, itemID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"item": it})
}

// parsePrototypeMeta 解析并列的 titles/descs 数组（前端以 JSON 字符串传，兼容空值）。
func parsePrototypeMeta(titlesRaw, descsRaw []string, n int) (titles, descs []string) {
	titles = make([]string, 0, n)
	descs = make([]string, 0, n)
	if len(titlesRaw) > 0 {
		_ = json.Unmarshal([]byte(titlesRaw[0]), &titles)
	}
	if len(descsRaw) > 0 {
		_ = json.Unmarshal([]byte(descsRaw[0]), &descs)
	}
	for len(titles) < n {
		titles = append(titles, "")
	}
	for len(descs) < n {
		descs = append(descs, "")
	}
	return titles, descs
}
