package service

// 需求原型（doc_type=prototype）：把原型文件与「它要说明的需求」绑在一起。
//
// 与图片库的区别：图片库是「看图」，原型库是「看需求」——
// 每个文件都必须带标题与需求描述（谁上传的原型没有说明，两周后没人看得懂），
// 能直接展示的（HTML 包 / 图片）就地展示，展示不了的（.rp/.mp/.sketch 的专有格式）
// 保留原件下载 + 尽量抽一张预览图。
//
// 格式处理（与 imgconv 同构的混合降级思路）：
//   - 图片（png/jpg/svg/…）  → 生成预览图 + 缩略图
//   - 单个 html              → 直接嵌入
//   - zip / Axure 导出的网页包 → 解压后按相对路径落盘，嵌入入口页
//   - .rp（Axure 工程文件）  → 专有二进制，无法渲染：保留原件下载（降级）
//   - .mp（Mockplus）        → 先按 zip 试探，含网页入口就当网页包，否则降级
//   - .sketch                → 是 zip 结构，抽 previews/preview.png 当预览图，否则降级

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"

	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/imgconv"
	"haiku-wiki/server/internal/storage"
)

// PrototypeContent 需求原型正文 JSON（前端 types.ts 的 PrototypeContent 与之对应）。
type PrototypeContent struct {
	Version int             `json:"version"`
	Items   []PrototypeItem `json:"items"`
}

// PrototypeItem 一条原型（一个文件 + 它的需求说明）。
type PrototypeItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`              // 原型标题（上传时必填）
	Desc     string `json:"desc"`               // 需求描述
	Kind     string `json:"kind"`               // html | image | other
	URL      string `json:"url"`                // 原件
	Filename string `json:"filename"`           // 原始文件名
	Size     int64  `json:"size"`               // 原件字节数
	Ext      string `json:"ext"`                // 扩展名（不含点，小写）
	Entry    string `json:"entry,omitempty"`    // kind=html 时的入口页地址
	Preview  string `json:"preview,omitempty"`  // 预览图（灯箱/卡片用）
	Thumb    string `json:"thumb,omitempty"`    // 缩略图
	Degraded bool   `json:"degraded"`           // 没有可展示的预览
	Note     string `json:"note"`               // 降级原因 / 处理说明
	AddedAt  string `json:"added_at"`
}

// PrototypeUpload 一次上传的单个原型文件（标题必填，描述可选）。
type PrototypeUpload struct {
	Name  string
	Data  []byte
	Title string
	Desc  string
}

// PrototypeReject 被拒收的文件（不中断整批）。
type PrototypeReject struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

const prototypeVersion = 1

// 原型库允许的扩展名。
var prototypeExt = map[string]bool{
	// 原型工具的工程文件
	".rp": true, ".mp": true, ".sketch": true,
	// 网页原型（单页 / 打包）
	".html": true, ".htm": true, ".zip": true,
	// 图片原型（截图 / 标注图）
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true, ".bmp": true,
}

// PrototypeAllowedExt 交给前端做 accept 与提示文案。
func PrototypeAllowedExt() []string { return extList(prototypeExt) }

// PrototypeMaxBytes 单个原型文件上限（与全局上传上限同源）。
func PrototypeMaxBytes() int64 { return maxUploadBytes() }

// AddPrototypeItems 往原型库追加条目（批量）。
func (s *DocService) AddPrototypeItems(uid, docID uint64, files []PrototypeUpload) ([]PrototypeItem, []PrototypeReject, error) {
	if len(files) == 0 {
		return nil, nil, hkerr.Param("请选择要上传的原型文件")
	}
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, nil, err
	}
	if doc.DocType != "prototype" {
		return nil, nil, hkerr.Param("该文档不是需求原型")
	}
	content := parsePrototypeContent(doc.Content)

	added := make([]PrototypeItem, 0, len(files))
	rejected := make([]PrototypeReject, 0)
	for _, f := range files {
		it, err := buildPrototypeItem(uid, f)
		if err != nil {
			rejected = append(rejected, PrototypeReject{Name: f.Name, Reason: err.Error()})
			continue
		}
		added = append(added, *it)
	}
	if len(added) == 0 {
		return nil, rejected, nil
	}
	content.Version = prototypeVersion
	content.Items = append(content.Items, added...)
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

// UpdatePrototypeItem 改某条原型的标题与需求描述（原型没说明等于没有原型）。
func (s *DocService) UpdatePrototypeItem(uid, docID uint64, itemID, title, desc string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return hkerr.Param("标题不能为空")
	}
	if len(title) > 200 {
		title = title[:200]
	}
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return err
	}
	content := parsePrototypeContent(doc.Content)
	found := false
	for i := range content.Items {
		if content.Items[i].ID == itemID {
			content.Items[i].Title = title
			content.Items[i].Desc = desc
			found = true
		}
	}
	if !found {
		return hkerr.NotFound("原型不存在")
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

// RemovePrototypeItem 删除一条原型（原件、预览图与解压出来的网页包一并清理）。
func (s *DocService) RemovePrototypeItem(uid, docID uint64, itemID string) error {
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return err
	}
	content := parsePrototypeContent(doc.Content)
	rest := make([]PrototypeItem, 0, len(content.Items))
	var victim *PrototypeItem
	for i := range content.Items {
		if content.Items[i].ID == itemID {
			victim = &content.Items[i]
			continue
		}
		rest = append(rest, content.Items[i])
	}
	if victim == nil {
		return hkerr.NotFound("原型不存在")
	}
	content.Items = rest
	raw, err := json.Marshal(content)
	if err != nil {
		return hkerr.Internal("保存失败")
	}
	doc.Content = string(raw)
	if err := repository.UpdateDoc(doc); err != nil {
		return hkerr.Internal("保存失败")
	}

	// 清理文件：网页包是整个目录（uploads/prototype/<id>/…），其余是单文件 + 两张派生图
	if victim.Kind == "html" && strings.Contains(victim.Entry, "/prototype/") {
		_ = deletePrefix(path.Dir(mustKey(victim.Entry)))
	} else {
		_ = deleteUploaded(victim.URL)
	}
	for _, u := range []string{victim.Preview, victim.Thumb} {
		if u != "" && u != victim.URL && u != victim.Entry {
			_ = deleteUploaded(u)
		}
	}
	return nil
}

// ---------- 内部 ----------

func buildPrototypeItem(uid uint64, f PrototypeUpload) (*PrototypeItem, error) {
	name := strings.TrimSpace(f.Name)
	if name == "" {
		return nil, errStr("文件名缺失")
	}
	if strings.TrimSpace(f.Title) == "" {
		return nil, errStr("请填写原型标题")
	}
	ext := strings.ToLower(path.Ext(name))
	if !prototypeExt[ext] {
		return nil, errStr("不支持的原型格式 " + ext)
	}
	if len(f.Data) == 0 {
		return nil, errStr("文件为空")
	}
	it := &PrototypeItem{
		ID:       uuid.NewString(),
		Title:    strings.TrimSpace(f.Title),
		Desc:     strings.TrimSpace(f.Desc),
		Filename: name,
		Size:     int64(len(f.Data)),
		Ext:      strings.TrimPrefix(ext, "."),
		AddedAt:  time.Now().Format(time.RFC3339),
	}
	switch {
	case ext == ".zip":
		return buildZipPrototype(uid, f.Data, it)
	case ext == ".html" || ext == ".htm":
		return buildSingleHTML(uid, f.Data, it)
	case ext == ".sketch":
		return buildSketch(uid, f.Data, it)
	case ext == ".rp" || ext == ".mp":
		return buildProjectArchive(uid, f.Data, it)
	default:
		return buildImagePrototype(uid, f.Data, it)
	}
}

// 图片原型：走 imgconv，原生格式出预览图，HEIC/PSD 之类缺转换器时降级。
func buildImagePrototype(uid uint64, data []byte, it *PrototypeItem) (*PrototypeItem, error) {
	it.Kind = "image"
	out, err := saveBytes(uid, it.Filename, "", data)
	if err != nil {
		return nil, errStr("保存失败")
	}
	it.URL = out.URL
	res, err := imgconv.Convert(data, it.Filename)
	if err != nil || res.Degraded {
		it.Degraded = true
		it.Note = noteOf(res, err, "未能生成预览图")
		return it, nil
	}
	if res.ReuseOriginal {
		it.Preview, it.Thumb = out.URL, out.URL
		return it, nil
	}
	pv, err1 := saveDerivedFile(out.URL, "preview.jpg", res.Preview)
	tb, err2 := saveDerivedFile(out.URL, "thumb.jpg", res.Thumb)
	if err1 != nil || err2 != nil {
		it.Degraded, it.Note = true, "预览图保存失败"
		return it, nil
	}
	it.Preview, it.Thumb = pv, tb
	return it, nil
}

// 单页 HTML：直接存，入口就是它自己。
func buildSingleHTML(uid uint64, data []byte, it *PrototypeItem) (*PrototypeItem, error) {
	it.Kind = "html"
	out, err := saveBytes(uid, it.Filename, "", data)
	if err != nil {
		return nil, errStr("保存失败")
	}
	it.URL = out.URL
	it.Entry = out.URL
	it.Note = "单页原型，直接嵌入展示"
	return it, nil
}

// zip 网页包（Axure / Mockplus 导出的原型包）：解压后按原相对路径落盘，嵌入入口页。
func buildZipPrototype(uid uint64, data []byte, it *PrototypeItem) (*PrototypeItem, error) {
	files, err := unpackZip(data)
	if err != nil {
		// 不是 zip（或解压失败）：按图片再试一次（有些工具把原型导出成图）
		if fallback, e2 := buildImagePrototype(uid, data, it); e2 == nil && !fallback.Degraded {
			return fallback, nil
		}
		it.Kind = "other"
		it.Degraded = true
		it.Note = "无法解析该压缩包"
		out, e3 := saveBytes(uid, it.Filename, "", data)
		if e3 == nil {
			it.URL = out.URL
		}
		return it, nil
	}
	dir := "uploads/prototype/" + uuid.NewString()
	st := storage.Default()
	for _, f := range files {
		key := dir + "/" + f.Path
		if err := st.Put(key, f.Data, storage.MimeByExt(f.Path)); err != nil {
			it.Kind = "other"
			it.Degraded = true
			it.Note = "原型包保存失败"
			return it, nil
		}
	}
	entry := pickHTMLEntry(files)
	if entry == "" {
		it.Kind = "other"
		it.Degraded = true
		it.Note = "压缩包里没有找到可展示的网页入口"
		out, e := saveBytes(uid, it.Filename, "", data)
		if e == nil {
			it.URL = out.URL
		}
		return it, nil
	}
	it.Kind = "html"
	it.Entry = st.URL(dir + "/" + entry)
	// 原件仍保留（用户可能要下载整包）
	out, e := saveBytes(uid, it.Filename, "", data)
	if e == nil {
		it.URL = out.URL
	}
	it.Note = "网页原型包，入口：" + entry
	_ = uid
	return it, nil
}

// .rp / .mp 这类工程文件：先当 zip 试探（Mockplus、新版 Axure 的包本质是 zip），
// 能抽出网页入口就当网页原型，否则老实降级——专有二进制格式服务端渲染不了。
func buildProjectArchive(uid uint64, data []byte, it *PrototypeItem) (*PrototypeItem, error) {
	if files, err := unpackZip(data); err == nil && pickHTMLEntry(files) != "" {
		zipItem := *it
		got, err := buildZipPrototype(uid, data, &zipItem)
		if err == nil && got.Kind == "html" {
			if got.URL == "" {
				if out, e := saveBytes(uid, it.Filename, "", data); e == nil {
					got.URL = out.URL
				}
			}
			return got, nil
		}
	}
	out, err := saveBytes(uid, it.Filename, "", data)
	if err != nil {
		return nil, errStr("保存失败")
	}
	it.Kind = "other"
	it.URL = out.URL
	it.Degraded = true
	it.Note = "该格式无法在网页中渲染，请下载原件用对应工具打开"
	return it, nil
}

// .sketch 是 zip 结构，内部通常带一张 previews/preview.png —— 抽出来当预览图刚刚好。
func buildSketch(uid uint64, data []byte, it *PrototypeItem) (*PrototypeItem, error) {
	files, err := unpackZip(data)
	if err == nil {
	for _, f := range files {
		if strings.EqualFold(f.Path, "previews/preview.png") || strings.EqualFold(f.Path, "previews/preview.webp") {
				out, e := saveBytes(uid, it.Filename, "", data)
				if e != nil {
					return nil, errStr("保存失败")
				}
				it.URL = out.URL
				it.Kind = "image"
				if res, e2 := imgconv.Convert(f.Data, f.Path); e2 == nil && !res.Degraded && !res.ReuseOriginal {
					if pv, e3 := saveDerivedFile(out.URL, "preview.jpg", res.Preview); e3 == nil {
						it.Preview = pv
					}
					if tb, e4 := saveDerivedFile(out.URL, "thumb.jpg", res.Thumb); e4 == nil {
						it.Thumb = tb
					}
				}
				if it.Preview == "" {
					it.Degraded = true
					it.Note = "Sketch 预览图抽取失败"
				} else {
					it.Note = "已抽取 Sketch 内置预览图"
				}
				return it, nil
			}
		}
	}
	out, err := saveBytes(uid, it.Filename, "", data)
	if err != nil {
		return nil, errStr("保存失败")
	}
	it.Kind = "other"
	it.URL = out.URL
	it.Degraded = true
	it.Note = "Sketch 文件无法在网页中渲染，请下载原件用 Sketch 打开"
	return it, nil
}

// unpackZip 读取 zip（带体积/数量上限，防压缩包炸弹）。
func unpackZip(data []byte) ([]HTMLFile, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	const maxFiles, maxTotal, maxFile = 2000, 200 << 20, 50 << 20
	out := make([]HTMLFile, 0, len(zr.File))
	var total int64
	for _, zf := range zr.File {
		if len(out) >= maxFiles {
			break
		}
		if zf.FileInfo().IsDir() {
			continue
		}
		rel, err := safeHTMLPath(zf.Name)
		if err != nil {
			continue // 跳过危险条目，不整包失败
		}
		if zf.UncompressedSize64 > maxFile {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(io.LimitReader(rc, maxFile+1))
		_ = rc.Close()
		if err != nil || int64(len(b)) > maxFile {
			continue
		}
		total += int64(len(b))
		if total > maxTotal {
			break
		}
		out = append(out, HTMLFile{Path: rel, Data: b})
	}
	return out, nil
}

func parsePrototypeContent(raw string) PrototypeContent {
	var c PrototypeContent
	if strings.TrimSpace(raw) == "" {
		return PrototypeContent{Version: prototypeVersion, Items: []PrototypeItem{}}
	}
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return PrototypeContent{Version: prototypeVersion, Items: []PrototypeItem{}}
	}
	if c.Items == nil {
		c.Items = []PrototypeItem{}
	}
	return c
}

func noteOf(res *imgconv.Result, err error, fallback string) string {
	if res != nil && res.Note != "" {
		return res.Note
	}
	if err != nil {
		return err.Error()
	}
	return fallback
}

// errStr 让构造错误像内置错误一样被 errors.As 识别为业务错误。
func errStr(msg string) error { return hkerr.Param(msg) }

// deletePrefix 删除某个前缀下的全部对象（清理整个原型网页包）。
func deletePrefix(prefix string) error {
	keys, err := storage.Default().List(prefix)
	if err != nil {
		return err
	}
	for _, k := range keys {
		_ = storage.Default().Delete(k.Key)
	}
	return nil
}

// mustKey 把附件 URL 换算成存储键，忽略错误（清理场景，键无效时删空也无妨）。
func mustKey(url string) string {
	k, _ := uploadKey(url)
	return k
}
