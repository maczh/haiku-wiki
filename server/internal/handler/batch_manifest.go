package handler

// 批量入口（图片库 / 原型）的 manifest —— 两阶段协议的唯一真源（§12.2.2 / §12.2.3）。
//
// 协议背景：批量上传先做一次**无字节**的预检（`/api/uploads/precheck`），命中内容寻址的
// 文件不再传输字节；提交时前端送出 `manifest`（与用户所选条目**等长且同序**），
// 外加**仅未命中条目**的字节（`files[]`）。
//
// 为什么 manifest 是唯一真源：`files[]` 里**看不到**被秒传的条目，服务端只能靠 manifest
// 还原「第几个条目该配哪个文件 / 哪段标题」。一旦 manifest 与真实字节错位，
// 就会出现「A 图配了 B 的名字 / A 原型的标题挂到 B 上」这类**静默的数据污染**——
// 比直接失败严重得多。因此这里对「`len(files)` 是否等于 manifest 中 `kind=file` 条数」
// 做**整批拒绝**的强校验（§R13，本协议唯一严重失败模式）。
//
// 三层错误语义（务必区分，改这段前先读）：
//  1. manifest **格式/结构**非法（非法 JSON、非法 kind、非法 ref md5、文件名缺失、
//     size 为负、file 条数与收到的字节数不符）→ `40001` **整批拒绝**，一个字节都不落库；
//  2. 单条 `kind=ref` 的内容在库中查不到（原件被清 / 预检过期）→ 该条进 `rejected`
//     （固定文案见 `service.ReferenceExpiredReason`），**其余条目继续**；
//  3. manifest 缺省（老调用方只传 `files[]`）→ 退化为改造前的纯字节契约，行为完全不变。

import (
	"encoding/json"
	"log"
	"mime/multipart"
	"strconv"
	"strings"
)

// BatchManifestEntry manifest 的一个条目。
//
// JSON 字段名与前端 `web/src/types.ts` 的 `BatchManifestEntry` **逐字对应**，改任一侧都要同步。
type BatchManifestEntry struct {
	// Kind 条目类型："ref"（复用已存在内容，不传字节）| "file"（本次传输字节）
	Kind string `json:"kind"`
	// MD5 原件内容摘要（kind=ref 必填；kind=file 忽略）
	MD5 string `json:"md5"`
	// Name 原始文件名（展示与扩展名判定用）
	Name string `json:"name"`
	// Size 原件字节数（kind=ref 用于与库中原件比对；kind=file 供服务端交叉核对）
	Size int64 `json:"size"`
}

// BatchSummary 批量提交的结果概览（§12.2.2 / §12.2.3）——**专为验收断言设计**，
// 不含任何他人信息，也不承载正确性判定。
//
// 三个计数的口径（改这段前先读 §12.10 的判据 1/3/8）：
//   - Received   ：实际收到的文件段数（`len(files)`）。全部命中时该值为 0。
//   - Referenced ：引用式入库**成功**条数（= manifest 中 kind=ref 条数 − 引用失效被拒条数）。
//   - Written    ：**新写 CAS 对象数**（= 入库条目中 dedup=false 的条数）；
//     字节上传但命中已有内容（CAS 复用）不计入。
type BatchSummary struct {
	// Received 实际收到的文件段数（= len(files)）
	Received int `json:"received"`
	// Referenced 引用式入库成功条数（未传输任何字节）
	Referenced int `json:"referenced"`
	// Written 新写 CAS 对象数（dedup=false 的入库条目数）
	Written int `json:"written"`
}

// parseManifest 解析并**严格校验** manifest（§R13）。
//
// 返回 nil 表示「没有 manifest」——调用方据此走纯字节的旧契约（本协议必须向后兼容）。
// 出错时一律是**参数错误（40001 整批拒绝）**；调用方直接 `resp.Error(c, err)` 即可。
//
// fileCount 是本次请求实际收到的字节文件数（`len(form.File["files"])`）。
// 强校验：manifest 中 `kind=file` 的条数**必须**等于 fileCount —— 这是防止字节与
// 条目错位的唯一关口（错位会造成静默数据污染，见文件头注释）。
func parseManifest(raw string, fileCount int) ([]BatchManifestEntry, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil // 缺省 manifest：旧契约
	}
	var entries []BatchManifestEntry
	// json.Unmarshal 会拒绝尾部多余内容（`[{...}] {}` 这类脏数据不能静默放过，
	// 否则「唯一真源」就有了歧义）。
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil, paramMsg("manifest 格式不正确")
	}
	if entries == nil {
		entries = []BatchManifestEntry{}
	}

	fileDeclared := 0
	for i := range entries {
		e := &entries[i]
		e.Kind = strings.TrimSpace(e.Kind)
		e.MD5 = strings.ToLower(strings.TrimSpace(e.MD5))
		e.Name = strings.TrimSpace(e.Name)
		idx := strconv.Itoa(i)
		switch e.Kind {
		case "ref":
			if !isHexMD5Str(e.MD5) {
				return nil, paramMsg("manifest 第 " + idx + " 条的 md5 不合法")
			}
		case "file":
			fileDeclared++
		default:
			return nil, paramMsg("manifest 第 " + idx + " 条的 kind 不合法")
		}
		if e.Name == "" {
			return nil, paramMsg("manifest 第 " + idx + " 条缺少文件名")
		}
		if e.Size < 0 {
			return nil, paramMsg("manifest 第 " + idx + " 条的 size 不合法")
		}
	}

	// §R13：唯一严重失败模式 —— 字节与条目错位，整批拒绝（绝不错位入库）。
	if fileDeclared != fileCount {
		return nil, paramMsg("manifest 声明 " + strconv.Itoa(fileDeclared) + " 个待传输文件，实际收到 " + strconv.Itoa(fileCount) + " 个")
	}
	return entries, nil
}

// summarize 生成 summary（§12.2.2）。三个入参均由调用方按实际结果统计：
//
//	received     = 实际收到的文件段数（len(fhs)）
//	refFailed    = 因「引用结果已过期」被拒的条数（reason == service.ReferenceExpiredReason）
//	newlyWritten = 入库条目中 dedup=false 的条数（即真正写盘的 CAS 对象数）
//
// manifest 缺省（旧契约）时 referenced 恒为 0。
func summarize(manifest []BatchManifestEntry, received, refFailed, newlyWritten int) BatchSummary {
	s := BatchSummary{Received: received, Written: newlyWritten}
	if manifest == nil {
		return s
	}
	refs := 0
	for _, e := range manifest {
		if e.Kind == "ref" {
			refs++
		}
	}
	s.Referenced = refs - refFailed
	if s.Referenced < 0 {
		s.Referenced = 0
	}
	return s
}

// ---------- 共享的 multipart 辅助（图片库 / 原型两个批量入口共用） ----------

// firstFormValue 取 multipart 表单多值字段的第一个值（缺省返回空串）。
func firstFormValue(vals []string) string {
	if len(vals) > 0 {
		return vals[0]
	}
	return ""
}

// batchMode 本次提交的模式：`manifest`（两阶段）| `legacy`（旧契约，纯字节）。
func batchMode(manifest []BatchManifestEntry) string {
	if manifest == nil {
		return "legacy"
	}
	return "manifest"
}

// readBytesUpload 读完一个 multipart 文件到内存，并做与改造前**逐字相同**的三项校验。
//
// 返回 `(data, "")` 表示成功；`(nil, reason)` 表示该条应进 `rejected`（reason 为
// 面向用户的中文原因）。所有 reason 文案与既有行为保持一致，前端按文案展示。
func readBytesUpload(fh *multipart.FileHeader, lim int64) ([]byte, string) {
	if fh.Size > lim {
		return nil, "文件超过 " + strconv.FormatInt(lim>>20, 10) + "MB"
	}
	f, err := fh.Open()
	if err != nil {
		return nil, "文件无法读取"
	}
	defer func() { _ = f.Close() }()
	buf := make([]byte, fh.Size)
	n := 0
	for n < len(buf) {
		k, rerr := f.Read(buf[n:])
		n += k
		if rerr != nil {
			break
		}
	}
	if n == 0 {
		return nil, "文件为空"
	}
	return buf[:n], ""
}

// logManifestMismatch 当 manifest 与 multipart 分片自带的元数据不一致时留痕。
//
// 不改变行为（**以 manifest 为准**，它是唯一真源），只便于排查前端组包问题。
func logManifestMismatch(app string, m BatchManifestEntry, fh *multipart.FileHeader) {
	if m.Name != fh.Filename || m.Size != fh.Size {
		log.Printf("[%s] manifest 与字节元数据不一致 name=%q/%q size=%d/%d（以 manifest 为准）",
			app, m.Name, fh.Filename, m.Size, fh.Size)
	}
}
