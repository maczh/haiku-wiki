package service

// 内容寻址存储（CAS）与删除守卫。
//
// 职责：
//  1. 键名规则与摘要计算：CasPrefix / casKey / md5Hex / randHex6 / normalizeMD5 / isHexMD5；
//  2. casPut       —— 唯一写盘入口：命中即复用 storage_path（不 Put），未命中写 CAS 路径；
//  3. instantMeta  —— 秒传落库（不接收字节，仅新增 meta）；
//  4. referenceMeta—— 引用式批量入库（T02b；派生元数据三级回退见 derived_service.go）；
//  5. 删除守卫     —— shouldKeepPhysical / safeDeleteUploaded / safeDeletePrefix / safeDeleteOwnedSet。
//
// ⚠️ 临界区铁律（§13.1-C10/C11、§13.3-④）：casMu 锁内**只允许**短 DB 写
//（二次校验读、attachments 插入、attachment_derived upsert、UploadStat 累加）。
// 锁内**禁止** st.Exists()/Put()/Read()/Open()、imgconv.*、任何 S3/HTTP 调用、任何循环内 IO——
// 否则所有上传会排队等一次 HEAD（S3 情形），且锁内长事务会占住连接池（生产只有 20 条）。

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"path"
	"strings"
	"sync"
	"time"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// CasPrefix 内容寻址存储前缀。同时是将来孤儿清理的识别标记（P2-2）；
// 前端**不感知**该前缀（一律用服务端返回的 URL）。
const CasPrefix = "uploads/cas"

// casMu 串行化「查 md5 → 写盘 → 记 meta」与引用式入库。
// ⚠️ 锁内只做 DB 写，见文件头「临界区铁律」。
var casMu sync.Mutex

// normalizeMD5 统一 md5 出入口：一律小写去空白（§13.3-②，必做）。
//
// 为什么必须在**应用层**做：SQLite 的文本主键默认 BINARY → 大小写敏感；
// MySQL 默认 utf8mb4_0900_ai_ci → 大小写**不敏感**，同一 md5 的两种大小写会撞主键，
// 甚者静默 upsert 覆盖他人元数据（比报错更隐蔽）。
func normalizeMD5(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// isHexMD5 判断是否 32 位小写 hex（md5 格式校验，供秒传预检/入库使用）。
func isHexMD5(s string) bool {
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

// md5Hex 计算字节内容的 32 位小写 hex 摘要。
func md5Hex(data []byte) string {
	sum := md5.Sum(data)
	return hex.EncodeToString(sum[:])
}

// randHex6 生成 6 位 hex 随机后缀：让 CAS 键不可枚举（知道 md5 也猜不到完整 URL，R9）。
func randHex6() string {
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand 极端场景会失败：退化到纳秒低位，仍保证同一进程内几乎不撞
		return fmt.Sprintf("%06x", time.Now().UnixNano()&0xffffff)
	}
	return hex.EncodeToString(b)
}

// casKey 计算 CAS 物理对象键：uploads/cas/<md5 前2位>/<md5>-<随机6位hex>.<ext>（§9 原件键名）。
func casKey(md5v, ext string) string {
	m := normalizeMD5(md5v)
	if len(m) < 2 {
		m = "0" + m
	}
	return fmt.Sprintf("%s/%s/%s-%s%s", CasPrefix, m[:2], m, randHex6(), ext)
}

// ---------- 唯一写盘入口 ----------

// casPut 落 CAS + 记一条 meta + 累加统计；命中已有内容时复用其 storage_path 且**不写盘**。
//
// 白名单 / 大小校验由调用方（Save / SaveBytes）保持不变，本函数只负责存储与记账。
func casPut(uid uint64, filename, contentType string, data []byte) (*UploadOutput, error) {
	ext := strings.ToLower(path.Ext(filename))
	md5v := md5Hex(data)
	mime := contentType
	if mime == "" {
		mime = storage.MimeByExt(filename)
	}
	size := int64(len(data))
	st := storage.Default()

	// ---- 锁外①：预检（短 DB 读 + Exists；S3 下 Exists 是 HEAD，绝不能持锁）----
	if existing, err := repository.FindAttachmentByMD5(md5v); err == nil && existing != nil && existing.StoragePath != "" {
		if ok, _ := st.Exists(existing.StoragePath); ok {
			// 秒传：不写盘
			log.Printf("[cas] hit md5=%s size=%d", md5v, size)
			casMu.Lock()
			reuse := existing.StoragePath
			// 二次校验：并发请求可能已插入更新的一行（storage_path 恒相同，取最新即可）
			if latest, e := repository.FindAttachmentByMD5(md5v); e == nil && latest != nil && latest.StoragePath != "" {
				reuse = latest.StoragePath
			}
			err := createCASMeta(uid, filename, mime, reuse, size, md5v, true)
			casMu.Unlock()
			if err != nil {
				return nil, err
			}
			return &UploadOutput{URL: st.URL(reuse), Filename: filename, Size: size, MD5: md5v, Dedup: true}, nil
		}
	}

	// ---- 锁外②：写盘（唯一 IO）----
	key := casKey(md5v, ext)
	if err := st.Put(key, data, mime); err != nil {
		return nil, err
	}

	// ---- 锁内：二次校验（并发同内容请求可能已落 meta）+ 落 meta ----
	var orphan string
	finalPath, dedup := key, false
	casMu.Lock()
	if latest, e := repository.FindAttachmentByMD5(md5v); e == nil && latest != nil && latest.StoragePath != "" {
		// 竞争者先落库：复用它，自己的对象作废（保证该 md5 的 DISTINCT storage_path 恒为 1，R5）
		finalPath, dedup = latest.StoragePath, true
		if finalPath != key {
			orphan = key
		}
	}
	err := createCASMeta(uid, filename, mime, finalPath, size, md5v, dedup)
	casMu.Unlock()
	if err != nil {
		return nil, err
	}
	// 锁外清理竞争者场景下自己多写的对象（DELETE 属 IO，不持锁）
	if orphan != "" {
		_ = st.Delete(orphan)
	}
	return &UploadOutput{URL: st.URL(finalPath), Filename: filename, Size: size, MD5: md5v, Dedup: dedup}, nil
}

// instantMeta 秒传落库：复用已存在的 storage_path，仅新增 meta + 累加统计（不写盘、不收字节）。
//
// 未知 md5 → 40401（前端据此降级为普通上传）；大小不符 → 40901。
func instantMeta(uid uint64, md5v string, size int64, filename, mime string) (*UploadOutput, error) {
	md5v = normalizeMD5(md5v)
	if !isHexMD5(md5v) {
		return nil, hkerr.Param("内容摘要格式不正确")
	}
	// ---- 锁外：读原件 ----
	origin, err := repository.FindAttachmentByMD5(md5v)
	if err != nil || origin == nil || origin.StoragePath == "" {
		return nil, hkerr.NotFound("未知的内容摘要")
	}
	if size > 0 && origin.Size > 0 && origin.Size != size {
		return nil, hkerr.Conflict("文件大小与已存内容不一致")
	}
	if mime == "" {
		mime = origin.MimeType
	}
	if mime == "" {
		mime = storage.MimeByExt(filename)
	}
	contentSize := origin.Size

	// ---- 锁内：二次校验 + 落 meta ----
	casMu.Lock()
	reuse := origin.StoragePath
	if latest, e := repository.FindAttachmentByMD5(md5v); e == nil && latest != nil && latest.StoragePath != "" {
		reuse = latest.StoragePath
	}
	err = createCASMeta(uid, filename, mime, reuse, contentSize, md5v, true)
	casMu.Unlock()
	if err != nil {
		return nil, err
	}
	log.Printf("[cas] hit md5=%s size=%d", md5v, contentSize)
	st := storage.Default()
	return &UploadOutput{URL: st.URL(reuse), Filename: filename, Size: contentSize, MD5: md5v, Dedup: true}, nil
}

// createCASMeta 锁内调用：新增一条 attachment meta 并累加统计（hit=true 表示本次未写盘）。
//
// 注意统计口径（§12.7）：**每条新增 meta 计一次 TotalUploads**，与物理对象数无关。
func createCASMeta(uid uint64, filename, mime, storagePath string, size int64, md5v string, hit bool) error {
	att := &model.Attachment{
		UploaderID:  uid,
		Filename:    filename,
		StoragePath: storagePath,
		MimeType:    mime,
		Size:        size,
		MD5:         normalizeMD5(md5v),
		CreatedAt:   time.Now().UTC(),
	}
	if err := repository.CreateAttachment(att); err != nil {
		return err
	}
	return repository.BumpUploadStat(hit, size)
}

// ---------- 引用式入库（T02b） ----------

// ReferenceInput 引用式入库入参：只有 md5 + 文件名 + 大小，**没有字节**。
type ReferenceInput struct {
	MD5      string
	Filename string
	Size     int64
}

// ReferenceResult 引用式入库结果。
type ReferenceResult struct {
	URL     string
	Derived *model.AttachmentDerived // 供调用方构造 GalleryImage / PrototypeItem
	Dedup   bool                     // 恒为 true（引用式）
}

// referenceMeta 引用式入库：不写盘、不重新转换、不派生，仅新增 meta + 复用派生元数据。
//
// 临界区（§13.3-④）：锁外预检 + 派生；锁内只做「二次校验 + 落 meta + 累加统计」。
func referenceMeta(uid uint64, appName string, in ReferenceInput) (*ReferenceResult, error) {
	md5v := normalizeMD5(in.MD5)
	if !isHexMD5(md5v) {
		return nil, hkerr.Param("内容摘要格式不正确")
	}
	// ---- 锁外①：读原件 meta ----
	origin, err := repository.FindAttachmentByMD5(md5v)
	if err != nil || origin == nil || origin.StoragePath == "" {
		// 预检与提交之间原件被清（迁移/手工清理）→ 调用方据此降级为普通上传（§12.6）
		return nil, hkerr.NotFound("未找到该内容的原件")
	}
	// ---- 锁外②：确保派生元数据（L1 直用；L2/L3 读原件重派生 —— 最慢的一步，不能持锁）----
	derived, err := ensureDerived(md5v, appName)
	if err != nil {
		return nil, err
	}
	// ---- 锁内：二次校验 + 落 meta（只做 DB 写）----
	casMu.Lock()
	if latest, e := repository.LoadDerived(md5v); e == nil && latest != nil {
		derived = latest
	}
	err = createReferenceMeta(uid, in.Filename, origin, in.Size, md5v)
	casMu.Unlock()
	if err != nil {
		return nil, err
	}
	url := derived.OriginURL
	if url == "" {
		url = storage.Default().URL(origin.StoragePath)
	}
	return &ReferenceResult{URL: url, Derived: derived, Dedup: true}, nil
}

// createReferenceMeta 锁内调用：引用式新增一条 meta（复用原件 storage_path）并累加统计。
func createReferenceMeta(uid uint64, filename string, origin *model.Attachment, size int64, md5v string) error {
	if size <= 0 {
		size = origin.Size
	}
	att := &model.Attachment{
		UploaderID:  uid,
		Filename:    filename,
		StoragePath: origin.StoragePath,
		MimeType:    origin.MimeType,
		Size:        size,
		MD5:         normalizeMD5(md5v),
		CreatedAt:   time.Now().UTC(),
	}
	if err := repository.CreateAttachment(att); err != nil {
		return err
	}
	// 引用式必然未写盘 → 计一次命中
	return repository.BumpUploadStat(true, size)
}

// ---------- 删除守卫 ----------

// derivedExts 派生件的确定性扩展名（§9 派生件键名 = 原件键去掉扩展名 + "." + 派生扩展名）。
var derivedExts = []string{"svg", "png", "preview.jpg", "thumb.jpg", "original.jpg"}

// shouldKeepPhysical 判定某个存储键是否必须保留（不由删除路径清理）。
//
// D2：**CAS 前缀下的一切对象（原件 + 派生件）都不删**。派生件路径 =「原件键换扩展名」，
// 与原件同目录（同属 uploads/cas/…）；多个文档引用同一内容时共用同一份派生件，
// 删掉会毁掉别处正在引用的预览。孤儿对象交给 P2-2 的孤儿清理（识别标记就是这个前缀）。
func shouldKeepPhysical(key string) bool {
	return strings.HasPrefix(key, CasPrefix+"/")
}

// safeDeleteKey 按存储键删除，但守住共享与 CAS 原件（守卫的实际实现）。
func safeDeleteKey(key string) error {
	if key == "" {
		return nil
	}
	if shouldKeepPhysical(key) {
		return nil
	}
	n, err := repository.CountAttachmentsByPath(key)
	if err != nil {
		return err
	}
	if n > 1 {
		// 同一路径仍被别的 meta 引用 → 共享内容，不删
		return nil
	}
	return storage.Default().Delete(key)
}

// safeDeleteUploaded 按附件 URL 删除单个对象（走删除守卫）。
func safeDeleteUploaded(url string) error {
	key, err := uploadKey(url)
	if err != nil {
		return err
	}
	return safeDeleteKey(key)
}

// safeDeletePrefix 删除某个前缀目录下的全部对象，但守住 CAS 与共享。
//
// 前缀必须是受控常量（如 uploads/prototype/<uuid-hex>/），不含 % 与 _ ⇒ 不加 ESCAPE（§13.3-⑥）。
func safeDeletePrefix(prefix string) error {
	p := strings.TrimSpace(prefix)
	if p == "" {
		return nil
	}
	if shouldKeepPhysical(p) {
		return nil
	}
	n, err := repository.CountAttachmentsUnderPrefix(p)
	if err != nil {
		return err
	}
	if n > 1 {
		return nil
	}
	keys, err := storage.Default().List(p)
	if err != nil {
		return err
	}
	st := storage.Default()
	for _, k := range keys {
		// 纵深防御：逐 key 再复核前缀归属与 CAS 保留规则
		if !strings.HasPrefix(k.Key, p) || shouldKeepPhysical(k.Key) {
			continue
		}
		_ = st.Delete(k.Key)
	}
	return nil
}

// safeDeleteOwnedSet 删除「一条内容所拥有」的全部对象，但守住共享（§12.5）：
//  1. CountAttachmentsByPath(KeyFromURL(originURL)) > 1 → 该内容被多处引用 → 全部跳过；
//  2. key 前缀为 uploads/cas/ → 跳过（D2：物理内容一律不删）；
//  3. 其余（非 CAS 的 extraPrefixes、非 CAS 的派生件）按既有语义删除。
func safeDeleteOwnedSet(originURL string, extraPrefixes []string) error {
	origin := strings.TrimSpace(originURL)
	// 1) 共享判定（只用 DB，无 IO）
	if origin != "" {
		if key, err := uploadKey(origin); err == nil {
			n, cerr := repository.CountAttachmentsByPath(key)
			if cerr != nil {
				return cerr
			}
			if n > 1 {
				return nil // 被多处引用：一个对象都不删
			}
		}
	}
	// 2) 原件本体（CAS 前缀会被 shouldKeepPhysical 跳过）
	if origin != "" {
		if err := safeDeleteUploaded(origin); err != nil {
			return err
		}
		// 3) 确定性派生件
		if key, err := uploadKey(origin); err == nil {
			base := strings.TrimSuffix(key, path.Ext(key))
			for _, ext := range derivedExts {
				if derr := safeDeleteKey(base + "." + ext); derr != nil {
					return derr
				}
			}
		}
	}
	// 4) 额外前缀目录（zip 内页）
	for _, p := range extraPrefixes {
		if err := safeDeletePrefix(p); err != nil {
			return err
		}
	}
	return nil
}
