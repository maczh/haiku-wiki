package service

// 图片库（doc_type=gallery）：一本电子相册。
//
// 正文是一份 JSON 清单（GalleryContent），列出库里每张图的原件与两张派生图：
//   - url     ：上传的原件，永远保留（可下载、可重新生成派生图）
//   - preview ：标准尺寸预览图（最长边 1600），灯箱里看的那张
//   - thumb   ：缩略图（最长边 400），相册网格里那张
//
// 为什么原件和派生图分开存：原件动辄几 MB、几十 MP，直接塞进网格会把浏览器拖死；
// 而派生图丢了也不心疼（随时能从原件重建）。转换统一走 internal/service/imgconv，
// 缺外部转换器时降级为「只保留原件 + 占位卡」。

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/imgconv"
	"haiku-wiki/server/internal/storage"
)

// GalleryContent 图片库正文 JSON（前端 types.ts 的 GalleryContent 与之对应）。
type GalleryContent struct {
	Version int            `json:"version"`
	Images  []GalleryImage `json:"images"`
}

// GalleryImage 相册里的一张图。
type GalleryImage struct {
	ID       string `json:"id"`       // 稳定 id（删除用）
	Name     string `json:"name"`     // 原始文件名（可改）
	URL      string `json:"url"`      // 原件
	Preview  string `json:"preview"`  // 预览图（SVG 直通时等于 URL）
	Thumb    string `json:"thumb"`    // 缩略图（SVG 直通时等于 URL）
	Original string `json:"original"` // 原尺寸（图片库全是图片格式，故一律等于原图 URL）
	Size     int64  `json:"size"`     // 原件字节数
	Width    int    `json:"width"`    // 原图宽（未知为 0）
	Height   int    `json:"height"`   // 原图高（未知为 0）
	Ext      string `json:"ext"`      // 扩展名（不含点，小写）
	Degraded bool   `json:"degraded"` // 没能生成预览图
	Note     string `json:"note"`     // 降级原因 / 处理说明
	AddedAt  string `json:"added_at"`
}

// GalleryUpload 一次上传的单个文件（handler 读进内存后交给 service，避免在 handler 里做业务）。
type GalleryUpload struct {
	Name string
	Data []byte
}

// GalleryReject 被拒收的文件（不中断整批：一个坏文件不该让其余图片白传）。
type GalleryReject struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

const galleryVersion = 1

// GalleryMaxBytes 单张图片大小上限（字节）。
// 与全局上传上限同源（conf/application.yml 的 upload.max_size_mb），不另开一套配置口径。
func GalleryMaxBytes() int64 { return maxUploadBytes() }

// GalleryAllowedExt 图片库支持的格式（交给前端做 accept 与提示文案）。
func GalleryAllowedExt() []string {
	return extList(imgconv.AllowedExt())
}

// AddGalleryImages 往图片库里追加图片（批量，逐张转换）。
//
// 权限走文档级写权限（loadDocForAccess write=true），与正文编辑完全同口径。
// 单张失败只记入 rejects，其余照常入库——相册批量上传最怕「一张坏了全批作废」。
func (s *DocService) AddGalleryImages(uid, docID uint64, files []GalleryUpload) ([]GalleryImage, []GalleryReject, error) {
	if len(files) == 0 {
		return nil, nil, hkerr.Param("请选择要上传的图片")
	}
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, nil, err
	}
	if doc.DocType != "gallery" {
		return nil, nil, hkerr.Param("该文档不是图片库")
	}
	content := parseGalleryContent(doc.Content)

	added := make([]GalleryImage, 0, len(files))
	rejected := make([]GalleryReject, 0)
	for _, f := range files {
		img, err := buildGalleryImage(uid, f)
		if err != nil {
			rejected = append(rejected, GalleryReject{Name: f.Name, Reason: err.Error()})
			continue
		}
		added = append(added, *img)
	}
	if len(added) == 0 {
		// 全批被拒：不落库，直接把原因交给前端
		return nil, rejected, nil
	}
	content.Version = galleryVersion
	content.Images = append(content.Images, added...)
	raw, err := json.Marshal(content)
	if err != nil {
		return nil, rejected, hkerr.Internal("保存失败")
	}
	doc.Content = string(raw)
	if err := repository.UpdateDoc(doc); err != nil {
		return nil, rejected, hkerr.Internal("保存失败")
	}
	return added, rejected, nil
}

// RemoveGalleryImage 从图片库里删一张图（原件与派生图一并删除）。
func (s *DocService) RemoveGalleryImage(uid, docID uint64, imageID string) error {
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return err
	}
	if doc.DocType != "gallery" {
		return hkerr.Param("该文档不是图片库")
	}
	content := parseGalleryContent(doc.Content)
	rest := make([]GalleryImage, 0, len(content.Images))
	var victim *GalleryImage
	for i := range content.Images {
		if content.Images[i].ID == imageID {
			victim = &content.Images[i]
			continue
		}
		rest = append(rest, content.Images[i])
	}
	if victim == nil {
		return hkerr.NotFound("图片不存在")
	}
	content.Images = rest
	raw, err := json.Marshal(content)
	if err != nil {
		return hkerr.Internal("保存失败")
	}
	doc.Content = string(raw)
	if err := repository.UpdateDoc(doc); err != nil {
		return hkerr.Internal("保存失败")
	}
	// 清掉文件：派生图与原件都删（失败也只记过，正文已改，不能因此回滚）
	// SVG 直通时 preview/thumb 就是原件，去重后只删一次
	urls := []string{victim.URL}
	for _, u := range []string{victim.Preview, victim.Thumb} {
		if u != "" && u != victim.URL {
			urls = append(urls, u)
		}
	}
	for _, u := range urls {
		_ = deleteUploaded(u)
	}
	return nil
}

// RenameGalleryImage 改图片名（相册里默认显示原文件名，用户常想改成有意义的标题）。
func (s *DocService) RenameGalleryImage(uid, docID uint64, imageID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return hkerr.Param("名称不能为空")
	}
	if len(name) > 200 {
		name = name[:200]
	}
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return err
	}
	content := parseGalleryContent(doc.Content)
	found := false
	for i := range content.Images {
		if content.Images[i].ID == imageID {
			content.Images[i].Name = name
			found = true
		}
	}
	if !found {
		return hkerr.NotFound("图片不存在")
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return hkerr.Internal("保存失败")
	}
	doc.Content = string(raw)
	if err := repository.UpdateDoc(doc); err != nil {
		return hkerr.Internal("保存失败")
	}
	return nil
}

// ---------- 内部 ----------

// buildGalleryImage 落盘原件 + 生成两张派生图，组装成一条清单条目。
func buildGalleryImage(uid uint64, f GalleryUpload) (*GalleryImage, error) {
	name := strings.TrimSpace(f.Name)
	if name == "" {
		return nil, fmt.Errorf("文件名缺失")
	}
	ext := strings.ToLower(filepath.Ext(name))
	if !imgconv.IsAllowed(ext) {
		return nil, fmt.Errorf("不支持的图片格式 %s", ext)
	}
	if len(f.Data) == 0 {
		return nil, fmt.Errorf("文件为空")
	}
	out, err := saveBytes(uid, name, "", f.Data)
	if err != nil {
		return nil, fmt.Errorf("保存失败: %v", err)
	}
	img := &GalleryImage{
		ID:      uuid.NewString(),
		Name:    name,
		URL:     out.URL,
		Size:    int64(len(f.Data)),
		Ext:     strings.TrimPrefix(ext, "."),
		AddedAt: time.Now().Format(time.RFC3339),
	}
	res, err := imgconv.Convert(f.Data, name)
	if err != nil {
		// 转换层返回 error 意味着「连降级都做不了」（如格式根本不认识）——白名单已挡过，
		// 这里兜底成降级条目：原件已存，用户至少能下载。
		img.Degraded = true
		img.Note = err.Error()
		return img, nil
	}
	img.Width, img.Height = res.Width, res.Height
	img.Degraded = res.Degraded
	img.Note = res.Note
	if res.ReuseOriginal {
		// 矢量图：预览/缩略图直接用原件，浏览器按容器缩放，永不失真
		img.Preview, img.Thumb, img.Original = out.URL, out.URL, out.URL
		return img, nil
	}
	if res.Degraded {
		img.Preview, img.Thumb, img.Original = "", "", ""
		return img, nil
	}
	pv, err := saveDerivedFile(out.URL, "preview.jpg", res.Preview)
	if err != nil {
		img.Degraded, img.Note, img.Preview, img.Thumb, img.Original = true, "预览图保存失败", "", "", ""
		return img, nil
	}
	tb, err := saveDerivedFile(out.URL, "thumb.jpg", res.Thumb)
	if err != nil {
		img.Degraded, img.Note, img.Preview, img.Thumb, img.Original = true, "缩略图保存失败", "", "", ""
		return img, nil
	}
	// 图片库全是图片格式：原尺寸直接复用原图 URL，不另存 original.jpg（避免冗余存储）
	img.Preview, img.Thumb, img.Original = pv, tb, out.URL
	return img, nil
}

// parseGalleryContent 解析正文；空/损坏时返回空清单，不让一篇坏 JSON 毁掉整个文档。
func parseGalleryContent(raw string) GalleryContent {
	var c GalleryContent
	if strings.TrimSpace(raw) == "" {
		return GalleryContent{Version: galleryVersion, Images: []GalleryImage{}}
	}
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return GalleryContent{Version: galleryVersion, Images: []GalleryImage{}}
	}
	if c.Images == nil {
		c.Images = []GalleryImage{}
	}
	return c
}

func extList(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, strings.TrimPrefix(k, "."))
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// deleteUploaded 按附件 URL 删除存储里的对象（local/S3 通用）。
func deleteUploaded(url string) error {
	key, err := uploadKey(url)
	if err != nil {
		return err
	}
	return storage.Default().Delete(key)
}

// RegenerateGalleryImage 重新生成某张图片的三档预览图（覆盖旧派生图），用于首次转换
// 降级/缺转换器后的补救。图片库全是图片格式，故 original 一律等于原图 URL。
func (s *DocService) RegenerateGalleryImage(uid, docID uint64, imageID string) (*GalleryImage, error) {
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, err
	}
	if doc.DocType != "gallery" {
		return nil, hkerr.Param("该文档不是图片库")
	}
	content := parseGalleryContent(doc.Content)
	idx := -1
	for i := range content.Images {
		if content.Images[i].ID == imageID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, hkerr.NotFound("图片不存在")
	}
	img := content.Images[idx]
	data, err := readUploadedFile(img.URL)
	if err != nil {
		return nil, hkerr.Internal("读取原件失败")
	}
	res, err := imgconv.Convert(data, img.Name)
	if err != nil || res.Degraded {
		// 转换失败/降级：保留原件，清掉预览图，前端显示占位卡
		img.Degraded = true
		img.Note = noteOf(res, err, "无法重新生成预览图")
		img.Preview, img.Thumb, img.Original = "", "", ""
	} else if res.ReuseOriginal {
		// 矢量图：三档都直接用原文件 URL
		img.Preview, img.Thumb, img.Original = img.URL, img.URL, img.URL
		img.Degraded = false
	} else {
		// 覆盖旧派生图（saveDerivedFile 用确定性文件名，Put 原地覆盖）
		if pv, e1 := saveDerivedFile(img.URL, "preview.jpg", res.Preview); e1 == nil {
			img.Preview = pv
		}
		if tb, e2 := saveDerivedFile(img.URL, "thumb.jpg", res.Thumb); e2 == nil {
			img.Thumb = tb
		}
		// 图片格式：原尺寸直接复用原图 URL
		img.Original = img.URL
		img.Width, img.Height = res.Width, res.Height
		img.Degraded = false
	}
	content.Images[idx] = img
	raw, err := json.Marshal(content)
	if err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	doc.Content = string(raw)
	if err := repository.UpdateDoc(doc); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	return &img, nil
}
