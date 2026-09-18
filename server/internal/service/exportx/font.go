// Package exportx 服务端文档导出：把库内各类型文档内容转换为可下载文件。
//
// 支持格式（按文档类型）：
//   - markdown  文档：.md / .docx / .pdf
//   - sheet     表格：.xlsx / .csv / .json
//   - mindmap   思维导图：.km / .smm / .xmind / .mm / .png
//   - flowchart 流程图：.md / .svg / .png
//
// 所有转换都在服务端完成，前端只负责发起请求并保存返回的二进制流。
package exportx

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/golang/freetype/truetype"
	"github.com/signintech/gopdf"
)

// cjkProbe 用于判定字体是否覆盖中文（无此字形则视为不可用于中文导出）。
const cjkProbe = '中'

// pdfProbeFamily 用 PDF 渲染器复验字体时使用的临时字族名（不进入任何产出）。
const pdfProbeFamily = "exportx-font-probe"

var (
	fontOnce  sync.Once
	fontBytes []byte
	fontPath  string
	fontErr   error
)

// 各平台候选字体的实测矩阵（2026-09，用 hasCJK + pdfRendererError 两道校验跑出来的结论，
// 实体字体取自 Debian fonts-wqy-* 与 Alpine font-wqy-zenhei / font-noto-cjk 的官方包）：
//
//	平台/字体                                            文件                 hasCJK  gopdf
//	macOS  /System/Library/Fonts/STHeiti Light.ttc       55MB TTC (glyf)      ✓       ✗ No Unicode encoding found
//	macOS  /System/Library/Fonts/Hiragino Sans GB.ttc    CFF                  —       —  normalizeFont 即拒绝（bad maxp length）
//	macOS  Supplemental/Arial Unicode.ttf               23MB TTF              ✓       ✓
//	macOS  Supplemental/Songti.ttc                      3.3MB TTC (glyf)      ✓       ✓
//	Linux  wqy-microhei.ttc / wqy-zenhei.ttc            TTC (glyf)            ✓       ✓  ← 容器环境首选
//	Linux  NotoSansCJK-Regular.ttc / NotoSerifCJK*.ttc  TTC 内为 CFF('OTTO')  —       —  normalizeFont 即拒绝
//
// 结论：容器侧继续用 font-wqy-zenhei（Alpine community 包，Alpine 只有这一个 wqy 包），
// 不要改投 font-noto-cjk —— 它内部是 CFF 轮廓，当前管线（freetype truetype + TTC 抽首字体）
// 无法消费，换了反而彻底没字体可用。将来若要支持 Noto，需要先引入 CFF → glyf 或支持 OTF 的渲染路径。
//
// ttfCandidates 常见系统中文字体路径（按优先级；找不到时回退目录扫描）。
//
// 顺序原则：**经实测能被 gopdf 加载的字体排在前面**，未验证/已知有问题的排在后面。
// 因为每个候选都要通过 hasCJK + pdfRendererError 两道校验才会被选中，
// 「排在前面」只表示偏好，不代表会被无条件采用 —— 通不过的候选自动顺延到下一个。
// 这样既避免了「先读 55MB 的 STHeiti 再发现不可用」这类浪费，
// 也不会因为顺序调整让某个平台失去兜底选项。
func ttfCandidates() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{
			// PingFang：存在时为首选（系统 UI 字体，字形现代）；部分 macOS 版本不在此路径
			"/System/Library/Fonts/PingFang.ttc",
			// Arial Unicode：无衬线，覆盖全，实测可用（23MB，Apple 自带）
			"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
			"/Library/Fonts/Arial Unicode.ttf",
			// Songti：衬线兜底，体积小（3.3MB），实测可用
			"/System/Library/Fonts/Supplemental/Songti.ttc",
			// STHeiti Light：实测 hasCJK 通过但 gopdf 报 "No Unicode encoding found"
			// （BUG-R6-02 的触发者）；保留在候选里，若个别环境能通过校验仍可用。
			"/System/Library/Fonts/STHeiti Light.ttc",
			// Hiragino Sans GB：CFF 轮廓，normalizeFont 阶段就会被拦下
			"/System/Library/Fonts/Hiragino Sans GB.ttc",
		}
	case "windows":
		win := os.Getenv("WINDIR")
		if win == "" {
			win = `C:\Windows`
		}
		dir := filepath.Join(win, "Fonts")
		return []string{
			filepath.Join(dir, "msyh.ttc"),
			filepath.Join(dir, "msyh.ttf"),
			filepath.Join(dir, "simhei.ttf"),
			filepath.Join(dir, "simsun.ttc"),
			filepath.Join(dir, "Deng.ttf"),
		}
	default: // linux 及容器环境
		return []string{
			// WenQuanYi：实测（Debian fonts-wqy-* 与 Alpine font-wqy-zenhei 的实体文件）
			// hasCJK=true 且能被 gopdf 加载 —— Linux 侧的首选。
			// micro（无衬线，视觉更现代）优先，zenhei 随后。
			"/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
			"/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
			// Alpine 的 font-wqy-zenhei 装到这里（Dockerfile 内置该包，已实测可用）
			"/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc",
			"/usr/share/fonts/wqy-microhei/wqy-microhei.ttc",
			"/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc",
			"/usr/share/fonts/truetype/arphic/uming.ttc",
			"/usr/share/fonts/truetype/arphic/ukai.ttc",
			"/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
			// 以下 Noto CJK 一律排在最后：实测它们内部是 CFF 轮廓（sfntVersion='OTTO'），
			// normalizeFont（freetype truetype）会直接以 "bad maxp length: 6" 拒绝 ——
			// 在支持 CFF 之前这几条不会被选中，保留仅为将来改造留位。
			"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
			"/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
			// LiberationSans 无中文字形，hasCJK 会拦下（仅作极端兜底探针）
			"/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
		}
	}
}

// fontScanDirs 候选字体目录（最后兜底：目录内查找首个覆盖中文的字体）。
func fontScanDirs() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{"/System/Library/Fonts", "/Library/Fonts", "/System/Library/Fonts/Supplemental"}
	case "windows":
		win := os.Getenv("WINDIR")
		if win == "" {
			win = `C:\Windows`
		}
		return []string{filepath.Join(win, "Fonts")}
	default:
		return []string{
			"/usr/share/fonts", "/usr/local/share/fonts", "/usr/share/fonts/truetype",
			"/usr/share/fonts/opentype", "/opt/share/fonts",
		}
	}
}

// LoadFont 返回可直接嵌入 PDF / 用于栅格化的 CJK TrueType 字体字节（进程内缓存）。
//
// 解析顺序：EXPORT_FONT_PATH → 各平台常见路径 → 字体目录扫描。
// 返回的字节一定是单字体 TTF（TTC 会被抽出首个字体并重建）。
//
// 两道校验缺一不可（BUG-R6-02）：
//  1. hasCJK —— 用 freetype 解析并探测 CJK 字形，保证覆盖中文；
//  2. usableByPDFRenderer —— 用真正消费字体的 gopdf 再加载一次。
//     两个解析器容忍度不同：macOS 的 STHeiti Light.ttc 能通过 ①，
//     却因 cmap 缺少 platformID=3/encodingID=1 的 format 4 子表被 gopdf 拒绝
//     （"No Unicode encoding found"），于是 LoadFont 成功、BuildPDF 全线失败。
//     故必须用「最终消费者」复验，而不是让 freetype 代为背书。
func LoadFont() ([]byte, error) {
	fontOnce.Do(func() {
		fontBytes, fontPath, fontErr = resolveFont()
	})
	return fontBytes, fontErr
}

// FontPath 返回实际采用的字体路径（未加载或失败时为空）。
func FontPath() string {
	if fontBytes == nil {
		_, _ = LoadFont()
	}
	return fontPath
}

// ResetFontCache 清空字体缓存（测试用）。
func ResetFontCache() {
	fontOnce = sync.Once{}
	fontBytes, fontPath, fontErr = nil, "", nil
}

func resolveFont() ([]byte, string, error) {
	if custom := strings.TrimSpace(os.Getenv("EXPORT_FONT_PATH")); custom != "" {
		// 显式指定的字体不可用时**不直接失败**：容器镜像里常把该变量烘焙进
		// 环境变量，一旦包名/路径对不上（例如发行版把字体装到别的目录）就会
		// 让所有 PDF / PNG 导出全线报错。这里降级为打印警告并继续自动探测，
		// 保证「装了中文字体就能导出」这一最低预期成立。
		raw, err := os.ReadFile(custom)
		if err != nil {
			log.Printf("[exportx] EXPORT_FONT_PATH=%s 无法读取（%v），改用自动探测", custom, err)
		} else if ttf, nerr := normalizeFont(raw); nerr != nil {
			log.Printf("[exportx] EXPORT_FONT_PATH=%s 不是可用的字体（%v），改用自动探测", custom, nerr)
		} else if perr := pdfRendererError(ttf); perr != nil {
			// 显式指定的字体若通不过最终消费者（gopdf），同样降级为自动探测。
			// 典型场景：容器镜像把 EXPORT_FONT_PATH 烘焙成 wqy-zenhei.ttc，
			// 而该 TTC 缺少 gopdf 要求的 Unicode cmap 子表 —— 此时不降级就等于
			// 所有 PDF/PNG 导出全部失败。与上面「不可读就自动探测」保持同一策略。
			log.Printf("[exportx] EXPORT_FONT_PATH=%s 不是 PDF 渲染器可加载的字体（%v），改用自动探测", custom, perr)
		} else {
			return ttf, custom, nil
		}
	}

	// 候选按「通过两道校验」的第一个为准：hasCJK 保证有中文字形，
	// pdfRendererError 保证真正能出 PDF，二者都不满足才换下一个候选。
	for _, p := range ttfCandidates() {
		raw, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		ttf, err := normalizeFont(raw)
		if err != nil {
			continue
		}
		if !hasCJK(ttf) {
			continue
		}
		if perr := pdfRendererError(ttf); perr != nil {
			log.Printf("[exportx] 字体 %s 覆盖中文但 PDF 渲染器无法加载（%v），换下一个候选", p, perr)
			continue
		}
		return ttf, p, nil
	}

	if ttf, p, ok := scanFontDirs(); ok {
		return ttf, p, nil
	}

	return nil, "", fmt.Errorf("未找到可用的中文字体：请安装中文字体（如 fonts-wqy-microhei / wqy-microhei）" +
		"或通过环境变量 EXPORT_FONT_PATH 指定 .ttf/.ttc 字体文件")
}

func scanFontDirs() ([]byte, string, bool) {
	seen := 0
	for _, dir := range fontScanDirs() {
		var found []byte
		var foundPath string
		_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if seen > 400 { // 目录可能很大，限制候选数量
				return filepath.SkipAll
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".ttf" && ext != ".ttc" {
				return nil
			}
			seen++
			raw, rerr := os.ReadFile(path)
			if rerr != nil {
				return nil
			}
			ttf, cerr := normalizeFont(raw)
			if cerr != nil || !hasCJK(ttf) {
				return nil
			}
			// 与候选列表同一标准：PDF 渲染器加载不了就继续扫描下一个文件
			if perr := pdfRendererError(ttf); perr != nil {
				log.Printf("[exportx] 字体 %s 覆盖中文但 PDF 渲染器无法加载（%v），继续扫描", path, perr)
				return nil
			}
			found, foundPath = ttf, path
			return filepath.SkipAll
		})
		if found != nil {
			return found, foundPath, true
		}
	}
	return nil, "", false
}

// pdfRendererError 用真正消费字体的 PDF 渲染器（gopdf）试加载一次。
//
// 返回 nil 表示该字体可以被嵌入 PDF；否则返回 gopdf 的原始错误。
// 与 BuildPDF 的调用方式保持一致（Start → AddTTFFontData），因此这里通过
// 就意味着真正导出时也一定通过 —— 不会出现「选字成功、出图失败」。
//
// 注意不要把这层校验省掉退回只信 freetype：两个解析器对 cmap 的要求不同，
// gopdf 只认 platformID=3 / encodingID=1 且 format=4 的 Unicode 子表，
// 而 freetype 宽容得多（详见 LoadFont 的注释）。
func pdfRendererError(ttf []byte) error {
	if len(ttf) == 0 {
		return fmt.Errorf("字体字节为空")
	}
	pdf := &gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: gopdf.Rect{W: 595, H: 842}})
	if err := pdf.AddTTFFontData(pdfProbeFamily, ttf); err != nil {
		return err
	}
	return nil
}

// hasCJK 判定字体是否覆盖探测汉字。
func hasCJK(ttf []byte) bool {
	f, err := truetype.Parse(ttf)
	if err != nil {
		return false
	}
	return f.Index(cjkProbe) != 0
}

// normalizeFont 把 TTC 提取为单字体 TTF；已是 TTF 时原样返回并做解析校验。
func normalizeFont(raw []byte) ([]byte, error) {
	out := raw
	if len(raw) >= 4 && string(raw[0:4]) == "ttcf" {
		var err error
		out, err = extractFirstTTF(raw)
		if err != nil {
			return nil, err
		}
	}
	if _, err := truetype.Parse(out); err != nil {
		return nil, err
	}
	return out, nil
}

// extractFirstTTF 从 TTC（TrueType Collection）中抽出首个字体并重建为独立 TTF。
// PDF 生成库只接受单字体文件，因此需要对 .ttc 做一次结构重写。
func extractFirstTTF(raw []byte) ([]byte, error) {
	if len(raw) < 16 {
		return nil, fmt.Errorf("ttc 文件过短")
	}
	numFonts := binary.BigEndian.Uint32(raw[8:12])
	if numFonts == 0 {
		return nil, fmt.Errorf("ttc 中没有字体")
	}
	base := int(binary.BigEndian.Uint32(raw[12:16]))
	if base+12 > len(raw) {
		return nil, fmt.Errorf("ttc 目录偏移越界")
	}
	numTables := int(binary.BigEndian.Uint16(raw[base+4 : base+6]))

	type tableRec struct {
		tag      string
		checksum uint32
		offset   uint32
		length   uint32
	}
	recs := make([]tableRec, 0, numTables)
	for i := 0; i < numTables; i++ {
		p := base + 12 + i*16
		if p+16 > len(raw) {
			return nil, fmt.Errorf("ttc 表目录被截断")
		}
		recs = append(recs, tableRec{
			tag:      string(raw[p : p+4]),
			checksum: binary.BigEndian.Uint32(raw[p+4 : p+8]),
			offset:   binary.BigEndian.Uint32(raw[p+8 : p+12]),
			length:   binary.BigEndian.Uint32(raw[p+12 : p+16]),
		})
	}
	sort.Slice(recs, func(i, j int) bool { return recs[i].tag < recs[j].tag })

	var buf bytes.Buffer
	hdr := make([]byte, 12)
	binary.BigEndian.PutUint32(hdr[0:4], 0x00010000) // TrueType 轮廓
	binary.BigEndian.PutUint16(hdr[4:6], uint16(numTables))
	searchRange := 1
	for searchRange*2 <= numTables {
		searchRange *= 2
	}
	binary.BigEndian.PutUint16(hdr[6:8], uint16(searchRange*16))
	binary.BigEndian.PutUint16(hdr[8:10], uint16(log2(searchRange)))
	binary.BigEndian.PutUint16(hdr[10:12], uint16(numTables*16-searchRange*16))
	buf.Write(hdr)

	offset := 12 + numTables*16
	for _, r := range recs {
		entry := make([]byte, 16)
		copy(entry[0:4], r.tag)
		binary.BigEndian.PutUint32(entry[4:8], r.checksum)
		binary.BigEndian.PutUint32(entry[8:12], uint32(offset))
		binary.BigEndian.PutUint32(entry[12:16], r.length)
		buf.Write(entry)
		offset += int(r.length)
		if pad := offset % 4; pad != 0 {
			offset += 4 - pad
		}
	}
	for _, r := range recs {
		start, end := int(r.offset), int(r.offset)+int(r.length)
		if end > len(raw) {
			return nil, fmt.Errorf("ttc 表数据越界：%s", r.tag)
		}
		buf.Write(raw[start:end])
		for buf.Len()%4 != 0 {
			buf.WriteByte(0)
		}
	}
	return buf.Bytes(), nil
}

func log2(n int) int {
	r := 0
	for n > 1 {
		n >>= 1
		r++
	}
	return r
}
