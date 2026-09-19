package handler

import (
	"encoding/json"
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// PrototypeAddItems POST /api/docs/:id/prototype/items —— 往原型库批量加原型。
//
// 与图片库不同，每个原型文件都必须带「标题」（必填）与「需求描述」（可选），
// 否则两周后没人看得懂这份原型在说明什么。用并列的三个表单字段传递：
//   - files[]  ：原型文件（Axure/.mp/.sketch/html/zip/图片）
//   - titles[] ：与 files[] 等长的标题数组（JSON 字符串）
//   - descs[]  ：与 files[] 等长的需求描述数组（JSON 字符串，可空）
//
// 后端逐张处理：能渲染的（html/图片）就地展示，专有格式（.rp/.mp/.sketch）保原件下载 +
// 尽量抽预览图，整批不因单张失败而作废（rejected 给出逐条原因）。
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
	if len(fhs) == 0 {
		resp.Error(c, paramMsg("请上传原型文件"))
		return
	}
	titles, descs := parsePrototypeMeta(form.Value["titles"], form.Value["descs"], len(fhs))

	lim := service.PrototypeMaxBytes()
	files := make([]service.PrototypeUpload, 0, len(fhs))
	rejected := make([]service.PrototypeReject, 0)
	for i, fh := range fhs {
		if fh.Size > lim {
			rejected = append(rejected, service.PrototypeReject{
				Name:   fh.Filename,
				Reason: "文件超过 " + strconv.FormatInt(lim>>20, 10) + "MB",
			})
			continue
		}
		f, err := fh.Open()
		if err != nil {
			rejected = append(rejected, service.PrototypeReject{Name: fh.Filename, Reason: "文件无法读取"})
			continue
		}
		buf := make([]byte, fh.Size)
		n := 0
		for n < len(buf) {
			k, err := f.Read(buf[n:])
			n += k
			if err != nil {
				break
			}
		}
		_ = f.Close()
		if n == 0 {
			rejected = append(rejected, service.PrototypeReject{Name: fh.Filename, Reason: "文件为空"})
			continue
		}
		title, desc := "", ""
		if i < len(titles) {
			title = titles[i]
		}
		if i < len(descs) {
			desc = descs[i]
		}
		files = append(files, service.PrototypeUpload{Name: fh.Filename, Data: buf[:n], Title: title, Desc: desc})
	}

	added, rej, err := docService.AddPrototypeItems(middleware.UID(c), id, files)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"items": added, "rejected": append(rejected, rej...)})
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
