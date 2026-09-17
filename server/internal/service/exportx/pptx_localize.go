package exportx

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"time"
)

// PPTX 外部（网络）图片本地化。
//
// 背景：.pptx 允许把图片「链接」到网络地址（PowerPoint 的"链接到文件"、部分在线
// 生成工具导出的幻灯片都是这种形态）。这类文件在没有外网的阅读环境里会整片空白——
// 图片既不在压缩包里，浏览器端渲染器也无从下载。
//
// 处理方式：在**导入时**把 pptx 里所有外链图片下载下来，作为 ppt/media/ 条目写回
// 压缩包，并把对应关系项从"外部目标"改成本地目标。改完之后这份 pptx 自带图片，
// 离线也能完整预览，且再导出/转发不会丢图。
//
// 安全性：excel 一类"打开文件就联网"的行为天然带 SSRF 风险，因此下载走
// 自定义 DialContext —— 在真正建连的那一刻校验对端 IP，拒绝内网/环回/链路本地地址，
// 并跟随重定向时逐跳校验（防 DNS rebinding 与 302 到 127.0.0.1）。

const (
	// 单张图片上限。幻灯片里的图片正常都在几百 KB 内，8MB 足够宽容。
	pptxMaxImageBytes = 8 << 20
	// 单份 pptx 最多本地化多少张。上限存在的意义是给"导入"这个动作一个确定的时间上界。
	pptxMaxImages = 24
	// 单张图片的下载超时。
	pptxFetchTimeout = 8 * time.Second
	// 整份 pptx 的下载总预算。
	pptxTotalBudget = 25 * time.Second
	pptxMaxRedirect = 3
)

// PptxAssetSaver 把下载到的图片存入文件库，返回可访问的相对 URL（形如 /uploads/...）。
// 允许为 nil —— 此时只做"嵌入压缩包"，不额外保存独立副本。
type PptxAssetSaver func(filename string, data []byte) (string, error)

// PptxLocalizeOptions 本地化选项。
type PptxLocalizeOptions struct {
	// Save 可选的图片入库回调。
	Save PptxAssetSaver
	// AllowPrivate 为真时允许下载内网地址（仅用于完全内网部署的场景，
	// 由环境变量 EXPORT_PPTX_IMG_ALLOW_PRIVATE 打开）。
	AllowPrivate bool
	// Client 可覆盖默认的 HTTP 客户端（测试注入用）。
	Client *http.Client
}

// PptxLocalizeResult 本地化结果。
type PptxLocalizeResult struct {
	// External 压缩包里发现的外链图片数量（按 URL 去重后）。
	External int `json:"external"`
	// Embedded 成功下载并写回压缩包的数量。
	Embedded int `json:"embedded"`
	// Assets 成功入库的图片 URL（Save 为空时为空）。
	Assets []string `json:"assets,omitempty"`
	// Failures 下载失败的 URL 与原因（截断后的可读文本）。
	Failures []string `json:"failures,omitempty"`
	// Changed 是否真的改写了压缩包。
	Changed bool `json:"changed"`
}

// Note 生成一句给用户看的结果描述；无需说明时返回空串。
func (r *PptxLocalizeResult) Note() string {
	if r == nil {
		return ""
	}
	if r.External == 0 {
		return "演示文稿内没有外链图片"
	}
	msg := fmt.Sprintf("已把 %d/%d 张网络图片下载并嵌入文件", r.Embedded, r.External)
	if len(r.Failures) > 0 {
		msg += fmt.Sprintf("，%d 张下载失败（仍保留原始链接）", len(r.Failures))
	}
	return msg
}

// ---------- 关系项（_rels/*.rels）解析 ----------

var (
	// <Relationship .../> —— OOXML 的关系项一定是自闭合标签
	relTagRe  = regexp.MustCompile(`(?s)<Relationship\b[^>]*?/?>`)
	relAttrRe = regexp.MustCompile(`(?s)\b(Id|Type|Target|TargetMode)\s*=\s*"([^"]*)"`)
	// 形如 r:link="rId5"；只对已本地化的 rId 做 link→embed 改写
	relLinkAttrRe = regexp.MustCompile(`([A-Za-z_][\w.\-]*):link="([^"]+)"`)
)

type pptxRel struct {
	tag    string
	id     string
	typ    string
	target string
	extern bool
}

// parsePptxRels 从一份 .rels 的原始字节中抽出关系项（保留原始标签文本以便原位改写）。
func parsePptxRels(data []byte) []pptxRel {
	tags := relTagRe.FindAll(data, -1)
	out := make([]pptxRel, 0, len(tags))
	for _, tag := range tags {
		r := pptxRel{tag: string(tag)}
		for _, m := range relAttrRe.FindAllSubmatch(tag, -1) {
			switch string(m[1]) {
			case "Id":
				r.id = string(m[2])
			case "Type":
				r.typ = string(m[2])
			case "Target":
				r.target = string(m[2])
			case "TargetMode":
				r.extern = strings.EqualFold(string(m[2]), "External")
			}
		}
		if r.id != "" {
			out = append(out, r)
		}
	}
	return out
}

// isExternalImageRel 判断是否为「外链图片」关系项。
//
// 必须同时满足两件事：类型是 image，且确实是外部目标。只判 TargetMode 会把
// 超链接（Type=.../hyperlink，目标常常也是 External）也算进来，那样会把网页当图片下载。
func isExternalImageRel(r pptxRel) bool {
	if !r.extern || r.id == "" || r.target == "" {
		return false
	}
	if !strings.HasSuffix(strings.ToLower(r.typ), "/image") {
		return false
	}
	u, err := url.Parse(strings.TrimSpace(r.target))
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		return u.Host != ""
	default:
		// file:// / ftp:// / data: 一律不处理：要么取不到，要么内联内容另有去处
		return false
	}
}

// relPartForRels 由 .rels 路径推出它描述的那个 part 的路径。
//   - ppt/slides/_rels/slide1.xml.rels → ppt/slides/slide1.xml
//   - _rels/.rels                     → ""（包级关系，没有对应的 part 文件）
func relPartForRels(relsPath string) string {
	dir := path.Dir(relsPath) // .../_rels
	if path.Base(dir) != "_rels" {
		return ""
	}
	base := path.Base(relsPath)
	if base == ".rels" {
		// 包级关系（_rels/.rels）没有对应的 part 文件
		return ""
	}
	name := strings.TrimSuffix(base, ".rels")
	parent := path.Dir(dir)
	if parent == "." {
		return name
	}
	return parent + "/" + name
}

// relsBaseDir 关系项 Target 的解析基准目录 —— 与 part 同目录，而非 _rels 目录。
func relsBaseDir(relsPath string) string {
	return path.Dir(path.Dir(relsPath))
}

// relativeRelTarget 把压缩包内绝对路径（如 ppt/media/x.png）写成相对 part 所在目录的 Target。
//
// 必须是真正的相对路径：OOXML 的关系项 Target 以"包含该 part 的目录"为基准，
// 比如 ppt/slides/slide1.xml 指向 ppt/media/x.png 时，Target 应为 ../media/x.png。
func relativeRelTarget(partDir, absPath string) string {
	if partDir == "" || partDir == "." {
		return absPath
	}
	from := strings.Split(partDir, "/")
	to := strings.Split(absPath, "/")
	// 从绝对路径里去掉公共前缀，剩下的每一段都要用 ../ 退回去
	i := 0
	for i < len(from) && i < len(to)-1 && from[i] == to[i] {
		i++
	}
	up := len(from) - i
	if up == 0 {
		return strings.Join(to[i:], "/")
	}
	return strings.Repeat("../", up) + strings.Join(to[i:], "/")
}

// ---------- 图片类型判定 ----------

// detectImageExt 依据字节魔数判定格式（比 Content-Type 与 URL 后缀都可靠）。
// 判定不出来返回空串（调用方据此跳过）。
func detectImageExt(data []byte) string {
	switch {
	case len(data) >= 8 && bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "png"
	case len(data) >= 3 && bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return "jpg"
	case len(data) >= 6 && (bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))):
		return "gif"
	case len(data) >= 2 && bytes.HasPrefix(data, []byte("BM")):
		return "bmp"
	case len(data) >= 12 && bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "webp"
	case len(data) >= 2 && data[0] == 0x01 && data[1] == 0x00:
		// 图标/光标；PPTX 里罕见，但顺手认了
		return "ico"
	}
	// SVG 是文本：允许 BOM 与声明头
	head := data
	if len(head) > 1024 {
		head = head[:1024]
	}
	head = bytes.TrimSpace(bytes.TrimPrefix(head, []byte("\xef\xbb\xbf")))
	if bytes.HasPrefix(head, []byte("<svg")) ||
		(bytes.HasPrefix(head, []byte("<?xml")) && bytes.Contains(head, []byte("<svg"))) {
		return "svg"
	}
	return ""
}

// ---------- 受控下载 ----------

// checkPublicIP 拒绝内网/本机/保留地址。downloadPPTXImage 的每一个连接都会走这里。
func checkPublicIP(ip net.IP) error {
	if ip == nil {
		return fmt.Errorf("目标地址无法解析")
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() ||
		ip.IsInterfaceLocalMulticast() {
		return fmt.Errorf("地址 %s 属于内网或本机", ip)
	}
	if v4 := ip.To4(); v4 != nil {
		// 0.0.0.0/8、100.64/10（运营商 CGNAT）、192.0.0.0/24、198.18/15、240/4
		switch {
		case v4[0] == 0, v4[0] >= 240:
			return fmt.Errorf("地址 %s 不是可路由的公网地址", ip)
		case v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127:
			return fmt.Errorf("地址 %s 属于运营商保留段", ip)
		case v4[0] == 198 && (v4[1] == 18 || v4[1] == 19):
			return fmt.Errorf("地址 %s 属于基准测试保留段", ip)
		}
	}
	return nil
}

// newGuardedPptxClient 建一个"只出公网"的 HTTP 客户端。
func newGuardedPptxClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	tr := &http.Transport{
		// 不读环境代理：走代理等于把地址校验交给别人，SSRF 防护会失效
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			var lastErr error
			for _, ip := range ips {
				if err := checkPublicIP(ip.IP); err != nil {
					lastErr = err
					continue
				}
				conn, derr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
				if derr == nil {
					return conn, nil
				}
				lastErr = derr
			}
			if lastErr == nil {
				lastErr = fmt.Errorf("域名 %s 没有可用的公网地址", host)
			}
			return nil, lastErr
		},
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 6 * time.Second,
		MaxIdleConns:          4,
		IdleConnTimeout:       15 * time.Second,
	}
	return &http.Client{
		Timeout:   pptxFetchTimeout,
		Transport: tr,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= pptxMaxRedirect {
				return fmt.Errorf("重定向次数过多")
			}
			// 跳转目标同样必须是 http(s)（IP 校验由 DialContext 逐跳完成）
			if s := strings.ToLower(req.URL.Scheme); s != "http" && s != "https" {
				return fmt.Errorf("不允许跳转到 %s 地址", s)
			}
			return nil
		},
	}
}

// pptxImageAllowedByEnv 允许通过环境变量放开内网限制（内网部署场景）。
func pptxImageAllowedByEnv() bool {
	v := strings.TrimSpace(os.Getenv("EXPORT_PPTX_IMG_ALLOW_PRIVATE"))
	return v == "1" || strings.EqualFold(v, "true")
}

// downloadPPTXImage 下载一张外链图片。返回值可能短于服务端声明（超限即截断后报错）。
func downloadPPTXImage(ctx context.Context, client *http.Client, rawURL string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("地址不合法")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("无法发起请求")
	}
	req.Header.Set("User-Agent", "haiku-wiki/1.0 (+pptx-image-localizer)")
	req.Header.Set("Accept", "image/*,*/*;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	// 多读 1 字节：读到上限+1 说明确实超标，而不是刚好等于上限
	data, err := io.ReadAll(io.LimitReader(resp.Body, pptxMaxImageBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取响应失败：%v", err)
	}
	if len(data) > pptxMaxImageBytes {
		return nil, fmt.Errorf("图片超过 %dMB 上限", pptxMaxImageBytes>>20)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("响应内容为空")
	}
	return data, nil
}

// ---------- 主流程 ----------

// LocalizePptxImages 把 pptx 内的外链图片下载后嵌入压缩包。
//
// 返回新的压缩包字节（未发生改动时 Changed=false 且 newData 为 nil）。
// 单个图片下载失败不会中断整体流程：失败的外链原样保留，由前端渲染器自行兜底。
func LocalizePptxImages(data []byte, opt PptxLocalizeOptions) (*PptxLocalizeResult, []byte, error) {
	res := &PptxLocalizeResult{}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return res, nil, fmt.Errorf("不是有效的 .pptx（应为 zip 压缩包）：%v", err)
	}

	entries := make(map[string][]byte, len(zr.File))
	for _, f := range zr.File {
		rc, oerr := f.Open()
		if oerr != nil {
			return res, nil, fmt.Errorf("读取压缩包条目 %s 失败：%v", f.Name, oerr)
		}
		b, rerr := io.ReadAll(io.LimitReader(rc, 128<<20))
		rc.Close()
		if rerr != nil {
			return res, nil, fmt.Errorf("读取压缩包条目 %s 失败：%v", f.Name, rerr)
		}
		entries[f.Name] = b
	}
	if _, ok := entries["ppt/presentation.xml"]; !ok {
		return res, nil, fmt.Errorf("压缩包内缺少 ppt/presentation.xml，不是标准的 .pptx")
	}

	// 1) 收集外链图片：rels 路径 → 需改写的关系项 id → URL
	type relHit struct {
		relsPath string
		relID    string
		rawURL   string
	}
	var hits []relHit
	urlOrder := []string{}
	urlSeen := map[string]bool{}
	for name, body := range entries {
		if !strings.HasSuffix(name, ".rels") || !strings.Contains(name, "_rels/") {
			continue
		}
		for _, r := range parsePptxRels(body) {
			if !isExternalImageRel(r) {
				continue
			}
			raw := strings.TrimSpace(r.target)
			hits = append(hits, relHit{relsPath: name, relID: r.id, rawURL: raw})
			if !urlSeen[raw] {
				urlSeen[raw] = true
				urlOrder = append(urlOrder, raw)
			}
		}
	}
	res.External = len(urlOrder)
	if res.External == 0 {
		return res, nil, nil
	}
	if len(urlOrder) > pptxMaxImages {
		res.Failures = append(res.Failures,
			fmt.Sprintf("外链图片 %d 张，超过单份 %d 张的处理上限，仅处理前 %d 张", len(urlOrder), pptxMaxImages, pptxMaxImages))
		urlOrder = urlOrder[:pptxMaxImages]
	}

	// 2) 下载 → 分配 media 路径
	client := opt.Client
	if client == nil {
		if opt.AllowPrivate || pptxImageAllowedByEnv() {
			client = &http.Client{Timeout: pptxFetchTimeout}
		} else {
			client = newGuardedPptxClient()
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pptxTotalBudget)
	defer cancel()

	mediaByURL := map[string]string{} // 原始 URL → 压缩包内路径
	usedName := map[string]bool{}
	for name := range entries {
		usedName[name] = true
	}
	seq := 0
	for _, raw := range urlOrder {
		if ctx.Err() != nil {
			res.Failures = append(res.Failures, fmt.Sprintf("总耗时超过 %s，剩余图片未处理", pptxTotalBudget))
			break
		}
		img, derr := downloadPPTXImage(ctx, client, raw)
		if derr != nil {
			res.Failures = append(res.Failures, fmt.Sprintf("%s：%v", trimURL(raw), derr))
			continue
		}
		ext := detectImageExt(img)
		if ext == "" {
			res.Failures = append(res.Failures, fmt.Sprintf("%s：响应不是可识别的图片", trimURL(raw)))
			continue
		}
		// 命中已嵌入的同一张图（相同 URL 只下载一次）之外，还要避免文件名冲突
		var mediaPath string
		for {
			seq++
			mediaPath = fmt.Sprintf("ppt/media/haiku-net-%d.%s", seq, ext)
			if !usedName[mediaPath] {
				break
			}
		}
		usedName[mediaPath] = true
		entries[mediaPath] = img
		mediaByURL[raw] = mediaPath
		res.Embedded++
		if opt.Save != nil {
			name := fmt.Sprintf("pptx-net-%d.%s", seq, ext)
			if u, serr := opt.Save(name, img); serr == nil && strings.TrimSpace(u) != "" {
				res.Assets = append(res.Assets, u)
			}
		}
	}
	if res.Embedded == 0 {
		return res, nil, nil
	}

	// 3) 改写关系项：外部目标 → 本地 media 路径，并去掉 TargetMode
	patchedRels := map[string][]byte{}
	for _, h := range hits {
		mediaPath, ok := mediaByURL[h.rawURL]
		if !ok {
			continue
		}
		body, ok := patchedRels[h.relsPath]
		if !ok {
			body = entries[h.relsPath]
		}
		base := relsBaseDir(h.relsPath)
		next := rewriteRelTarget(body, h.relID, relativeRelTarget(base, mediaPath))
		patchedRels[h.relsPath] = next
	}
	for name, body := range patchedRels {
		entries[name] = body
	}

	// 4) 把 r:link 改成 r:embed
	//    PowerPoint 的"链接图片"用 r:link 指向关系项；本地化之后它已经是包内资源，
	//    继续用 link 会被渲染器忽略，必须改成 embed 才会画出来。
	localizedByPart := map[string]map[string]bool{} // part 路径 → 本地化的 rId 集合
	for _, h := range hits {
		if _, ok := mediaByURL[h.rawURL]; !ok {
			continue
		}
		part := relPartForRels(h.relsPath)
		if part == "" {
			continue
		}
		if localizedByPart[part] == nil {
			localizedByPart[part] = map[string]bool{}
		}
		localizedByPart[part][h.relID] = true
	}
	for part, ids := range localizedByPart {
		body, ok := entries[part]
		if !ok {
			continue
		}
		entries[part] = rewriteLinkToEmbed(body, ids)
	}

	// 5) 重新打包
	out, werr := repackZip(entries)
	if werr != nil {
		return res, nil, werr
	}
	res.Changed = true
	return res, out, nil
}

// rewriteRelTarget 在原始 <Relationship .../> 标签上就地改写 Target / 去掉 TargetMode。
//
// 之所以用"文本替换"而不是反序列化再序列化：rels 里可能有本工具不认识的属性，
// 整体重组会丢掉它们；只动需要动的两个属性最安全。
func rewriteRelTarget(body []byte, relID, newTarget string) []byte {
	return relTagRe.ReplaceAllFunc(body, func(tag []byte) []byte {
		var id string
		for _, m := range relAttrRe.FindAllSubmatch(tag, -1) {
			if string(m[1]) == "Id" {
				id = string(m[2])
			}
		}
		if id != relID {
			return tag
		}
		tag = relAttrRe.ReplaceAllFunc(tag, func(attr []byte) []byte {
			m := relAttrRe.FindSubmatch(attr)
			if m == nil {
				return attr
			}
			key := string(m[1])
			if key == "Target" {
				return []byte(`Target="` + newTarget + `"`)
			}
			return attr
		})
		// 删掉 TargetMode="External"（连同其前面的空白）
		tag = regexp.MustCompile(`\s+TargetMode\s*=\s*"[^"]*"`).ReplaceAll(tag, nil)
		return tag
	})
}

// rewriteLinkToEmbed 把指定 rId 的 X:link="rId" 改成 X:embed="rId"。
//
// 前缀不写死：命名空间前缀由生成工具决定，用捕获组原样保留。
func rewriteLinkToEmbed(body []byte, ids map[string]bool) []byte {
	return relLinkAttrRe.ReplaceAllFunc(body, func(m []byte) []byte {
		sub := relLinkAttrRe.FindSubmatch(m)
		if sub == nil {
			return m
		}
		prefix, id := string(sub[1]), string(sub[2])
		if !ids[id] {
			return m
		}
		return []byte(prefix + `:embed="` + id + `"`)
	})
}

// repackZip 把条目重新打成 zip。
//
// 全部使用 Deflate：一来省掉"Store 条目必须预置 CRC/长度"的坑（改写后的条目长度
// 与原值不同），二来 OOXML 对两种方式都接受，不存在兼容性问题。
func repackZip(entries map[string][]byte) ([]byte, error) {
	names := make([]string, 0, len(entries))
	for n := range entries {
		names = append(names, n)
	}
	// [Content_Types].xml 放最前面更符合惯例（部分读者只顺序扫描头部）
	sortZipNames(names)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, n := range names {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: n, Method: zip.Deflate, Modified: pptxEntryTime})
		if err != nil {
			return nil, fmt.Errorf("写入压缩包条目 %s 失败：%v", n, err)
		}
		if _, err := w.Write(entries[n]); err != nil {
			return nil, fmt.Errorf("写入压缩包条目 %s 失败：%v", n, err)
		}
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("生成压缩包失败：%v", err)
	}
	return buf.Bytes(), nil
}

// pptxEntryTime 压缩包内条目的固定时间戳。
// 用固定值而非 time.Now()：同一份文件重复处理能产出逐字节相同的字节流，便于去重与比对。
var pptxEntryTime = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

func sortZipNames(names []string) {
	// 让 [Content_Types].xml 与 _rels/.rels 排前面，其余按字典序
	rank := func(n string) int {
		switch n {
		case "[Content_Types].xml":
			return 0
		case "_rels/.rels":
			return 1
		}
		return 2
	}
	for i := 1; i < len(names); i++ {
		for j := i; j > 0; j-- {
			a, b := names[j-1], names[j]
			if rank(a) < rank(b) || (rank(a) == rank(b) && a <= b) {
				break
			}
			names[j-1], names[j] = b, a
		}
	}
}

// trimURL 缩短 URL 便于放进错误提示。
func trimURL(raw string) string {
	if len(raw) <= 120 {
		return raw
	}
	return raw[:117] + "…"
}
