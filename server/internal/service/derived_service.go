package service

// 派生元数据缓存（attachment_derived）的构造、复用与三级回退。
//
// 这张缓存的唯一目的：让**引用式入库**（第二批/秒传）在不接收字节、不重新转换的前提下，
// 拿到与首次派生**逐字段相同**的条目元数据（width/height/degraded/note/kind/entry）。
// 详见 §12.3 / §12.4 / §12.5。

import (
	"path"
	"strings"
	"time"

	"github.com/google/uuid"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/imgconv"
	"haiku-wiki/server/internal/storage"
)

// ---------- 写入缓存（每次派生成功后 upsert，幂等） ----------

// CacheFromGalleryImage 用图片库条目的派生结果构造缓存行。
// 图片库派生件都在原件旁 ⇒ ExtraPrefix 恒为空。
func CacheFromGalleryImage(md5v, originURL string, img *GalleryImage) *model.AttachmentDerived {
	if img == nil || normalizeMD5(md5v) == "" {
		return nil
	}
	return &model.AttachmentDerived{
		MD5:         normalizeMD5(md5v),
		App:         "gallery",
		Ext:         img.Ext,
		Kind:        "image",
		OriginURL:   originURL,
		Preview:     img.Preview,
		Thumb:       img.Thumb,
		Original:    img.Original,
		Width:       img.Width,
		Height:      img.Height,
		Degraded:    img.Degraded,
		Note:        img.Note,
		ExtraPrefix: "",
	}
}

// CacheFromPrototypeItem 用原型条目的派生结果构造缓存行。
//
// ExtraPrefix 由入口页推导（kind=html 且 entry 非空）：zip 网页包的内页落在
// uploads/prototype/<随机 uuid>/…，与原件路径无关，必须记下来供删除守卫判断共享。
func CacheFromPrototypeItem(md5v string, it *PrototypeItem) *model.AttachmentDerived {
	if it == nil || normalizeMD5(md5v) == "" {
		return nil
	}
	d := &model.AttachmentDerived{
		MD5:       normalizeMD5(md5v),
		App:       "prototype",
		Ext:       it.Ext,
		Kind:      it.Kind,
		OriginURL: it.URL,
		Preview:   it.Preview,
		Thumb:     it.Thumb,
		Original:  it.Original,
		Entry:     it.Entry,
		Degraded:  it.Degraded,
		Note:      it.Note,
	}
	if it.Kind == "html" && it.Entry != "" {
		if key, err := uploadKey(it.Entry); err == nil {
			if dir := path.Dir(key); dir != "" && dir != "." && dir != "/" {
				d.ExtraPrefix = dir + "/"
			}
		}
	}
	return d
}

// ---------- 复用缓存（引用式入库的填充规则，§12.4 / §12.5） ----------

// ApplyDerivedToGalleryImage 用缓存字段填充一条引用式图片库条目（完全复用，不重算）。
//
// 每条引用是**独立条目**（有自己的 ID，删除用），但 URL 三档全部指向同一物理对象。
func ApplyDerivedToGalleryImage(name string, size int64, d *model.AttachmentDerived) GalleryImage {
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(name)), ".")
	if ext == "" {
		ext = d.Ext
	}
	return GalleryImage{
		ID:       uuid.NewString(),
		Name:     name,
		URL:      d.OriginURL,
		Preview:  d.Preview,
		Thumb:    d.Thumb,
		Original: d.Original,
		Size:     size,
		Width:    d.Width,
		Height:   d.Height,
		Ext:      ext,
		Degraded: d.Degraded,
		Note:     d.Note,
		AddedAt:  time.Now().Format(time.RFC3339),
	}
}

// ApplyDerivedToPrototypeItem 用缓存字段填充一条引用式原型条目（完全复用，不重算）。
//
// title/desc 由调用方按 manifest 索引传入（§12.5：titles/descs 与 manifest 对齐）。
func ApplyDerivedToPrototypeItem(title, desc, name string, size int64, d *model.AttachmentDerived) PrototypeItem {
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(name)), ".")
	if ext == "" {
		ext = d.Ext
	}
	return PrototypeItem{
		ID:       uuid.NewString(),
		Title:    strings.TrimSpace(title),
		Desc:     strings.TrimSpace(desc),
		Kind:     d.Kind,
		URL:      d.OriginURL,
		Filename: name,
		Size:     size,
		Ext:      ext,
		Entry:    d.Entry,
		Preview:  d.Preview,
		Thumb:    d.Thumb,
		Original: d.Original,
		Degraded: d.Degraded,
		Note:     d.Note,
		AddedAt:  time.Now().Format(time.RFC3339),
	}
}

// ---------- 三级回退 ----------

// ensureDerived 三级回退取派生元数据（§12.3）：
//
//	L1 缓存直用    ：有缓存行 且 原件 storage_path 存在 且 关键派生 URL（非空者）全部 Exists()
//	L2 缓存存在但派生文件缺失：读原件字节 → 重跑一次派生 → 覆写缓存
//	L3 无缓存行    ：同 L2
//
// 语义保证：要么给出完整派生元数据，要么返回错误（调用方把该条进 rejected）。
// L2/L3 是有界兜底（仅历史内容或异常清理后触发一次），不会成为常态路径 ——
// 因此这里读原件/解码/写派生件都发生在**casMu 锁外**。
func ensureDerived(md5v, appName string) (*model.AttachmentDerived, error) {
	md5v = normalizeMD5(md5v)
	var prev *model.AttachmentDerived
	if cache, err := repository.LoadDerived(md5v); err == nil && cache != nil {
		if derivedFilesIntact(cache) {
			return cache, nil // L1
		}
		prev = cache // L2：缓存存在但派生文件缺失（迁移/手工清理/容器重建）
	}
	// L2/L3 兜底：读原件重派生并覆写缓存
	origin, oerr := repository.FindAttachmentByMD5(md5v)
	if oerr != nil || origin == nil || origin.StoragePath == "" {
		return nil, hkerr.NotFound("未找到该内容的原件")
	}
	return rederiveAndCache(md5v, appName, origin, prev)
}

// derivedFilesIntact 判断缓存指向的文件是否仍然齐全（L1 条件）。
//
// 原件必须存在；preview/thumb/entry 中**非空者**必须存在。降级条目（三档为空）
// 只要原件在就算完整 —— 否则会陷入「每次引用都重派生一次仍降级」的循环。
func derivedFilesIntact(d *model.AttachmentDerived) bool {
	if d == nil || d.OriginURL == "" {
		return false
	}
	st := storage.Default()
	key, err := uploadKey(d.OriginURL)
	if err != nil {
		return false
	}
	if ok, _ := st.Exists(key); !ok {
		return false
	}
	for _, u := range []string{d.Preview, d.Thumb, d.Entry} {
		if u == "" {
			continue
		}
		k, err := uploadKey(u)
		if err != nil {
			return false
		}
		if ok, _ := st.Exists(k); !ok {
			return false
		}
	}
	return true
}

// rederiveAndCache 读原件字节 → 重跑一次派生 → 覆写缓存行。
func rederiveAndCache(md5v, appName string, origin *model.Attachment, prev *model.AttachmentDerived) (*model.AttachmentDerived, error) {
	originURL := storage.Default().URL(origin.StoragePath)
	data, err := readUploadedFile(originURL)
	if err != nil {
		return nil, hkerr.Internal("读取原件失败")
	}
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(origin.Filename)), ".")
	if ext == "" {
		ext = strings.TrimPrefix(strings.ToLower(path.Ext(origin.StoragePath)), ".")
	}

	var d *model.AttachmentDerived
	if appName == "prototype" {
		d = rederivePrototype(md5v, originURL, ext, data, prev)
	} else {
		d = rederiveGallery(md5v, originURL, ext, data, origin.Filename)
	}
	if d == nil {
		return nil, hkerr.Internal("派生元数据重建失败")
	}
	if err := repository.UpsertDerived(d); err != nil {
		return nil, err
	}
	return d, nil
}

// rederiveGallery 图片库的单次重派生（与 buildGalleryImage 同口径）。
func rederiveGallery(md5v, originURL, ext string, data []byte, filename string) *model.AttachmentDerived {
	name := filename
	if name == "" {
		name = "origin." + ext
	}
	d := &model.AttachmentDerived{
		MD5:       md5v,
		App:       "gallery",
		Ext:       ext,
		Kind:      "image",
		OriginURL: originURL,
	}
	res, err := imgconv.Convert(data, name)
	if err != nil {
		d.Degraded, d.Note = true, err.Error()
		return d
	}
	d.Width, d.Height = res.Width, res.Height
	d.Degraded, d.Note = res.Degraded, res.Note
	if res.ReuseOriginal {
		// 矢量图：三档直接用原件（ReuseOriginal 语义固化进缓存）
		d.Preview, d.Thumb, d.Original = originURL, originURL, originURL
		return d
	}
	if res.Degraded {
		d.Preview, d.Thumb, d.Original = "", "", ""
		return d
	}
	if pv, e := saveDerivedFile(originURL, "preview.jpg", res.Preview, true); e == nil {
		d.Preview = pv
	}
	if tb, e := saveDerivedFile(originURL, "thumb.jpg", res.Thumb, true); e == nil {
		d.Thumb = tb
	}
	d.Original = originURL
	return d
}

// rederivePrototype 原型的单次重派生。
//
// 网页包类（zip/rp/mp）无法从原件路径推导内页随机目录 → 重新解包并落一个新目录；
// 其余（图片/sketch/rp 内嵌图）走统一的预览分支 generatePrototypePreview（force=true 覆盖写）。
func rederivePrototype(md5v, originURL, ext string, data []byte, prev *model.AttachmentDerived) *model.AttachmentDerived {
	d := &model.AttachmentDerived{
		MD5:       md5v,
		App:       "prototype",
		Ext:       ext,
		Kind:      "other",
		OriginURL: originURL,
	}
	switch ext {
	case "zip", "rp", "mp":
		if files, err := unpackZip(data); err == nil {
			if entry := pickHTMLEntry(files); entry != "" {
				dir := "uploads/prototype/" + uuid.NewString()
				st := storage.Default()
				ok := true
				for _, f := range files {
					if perr := st.Put(dir+"/"+f.Path, f.Data, storage.MimeByExt(f.Path)); perr != nil {
						ok = false
						break
					}
				}
				if ok {
					d.Kind = "html"
					d.Entry = st.URL(dir + "/" + entry)
					d.ExtraPrefix = dir + "/"
					d.Note = "网页原型包（引用式重建），入口：" + entry
					return d
				}
			}
		}
	case "html", "htm":
		d.Kind = "html"
		d.Entry = originURL
		d.Note = "单页原型，直接嵌入展示"
		return d
	}
	// 其余：图片 / sketch 内置预览 / rp 内嵌图
	it := &PrototypeItem{URL: originURL, Ext: ext, Filename: "origin." + ext}
	if prev != nil && prev.Kind != "" {
		it.Kind = prev.Kind
	}
	srcData, srcName, isImage, ok := prototypePreviewSource(data, it)
	if !ok {
		d.Degraded, d.Note = true, "无法读取原件或抽取预览失败"
		return d
	}
	if isImage {
		d.Kind = "image"
	} else {
		d.Kind = "other"
	}
	_ = generatePrototypePreview(0, srcData, srcName, isImage, it, true)
	d.Preview, d.Thumb, d.Original = it.Preview, it.Thumb, it.Original
	d.Degraded, d.Note = it.Degraded, it.Note
	return d
}

// md5ByOriginURL 从 attachments 按 storage_path 反查内容摘要（拿不到返回 ""）。
// 供 Regenerate* 覆写缓存时使用（条目结构里没有 md5 字段）。
func md5ByOriginURL(originURL string) string {
	key, err := uploadKey(originURL)
	if err != nil {
		return ""
	}
	a, err := repository.FindAttachmentByStoragePath(key)
	if err != nil || a == nil {
		return ""
	}
	return normalizeMD5(a.MD5)
}
