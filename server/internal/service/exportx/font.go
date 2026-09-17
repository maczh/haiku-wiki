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
)

// cjkProbe 用于判定字体是否覆盖中文（无此字形则视为不可用于中文导出）。
const cjkProbe = '中'

var (
	fontOnce  sync.Once
	fontBytes []byte
	fontPath  string
	fontErr   error
)

// ttfCandidates 常见系统中文字体路径（按优先级；找不到时回退目录扫描）。
func ttfCandidates() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{
			"/System/Library/Fonts/PingFang.ttc",
			"/System/Library/Fonts/Hiragino Sans GB.ttc",
			"/System/Library/Fonts/STHeiti Light.ttc",
			"/Library/Fonts/Arial Unicode.ttf",
			"/System/Library/Fonts/Supplemental/Songti.ttc",
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
			"/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
			"/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
			// Alpine 的 font-wqy-zenhei 装到这里（Dockerfile 内置该包）
			"/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc",
			"/usr/share/fonts/wqy-microhei/wqy-microhei.ttc",
			"/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc",
			"/usr/share/fonts/truetype/arphic/uming.ttc",
			"/usr/share/fonts/truetype/arphic/ukai.ttc",
			"/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
			"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
			"/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
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
		} else {
			return ttf, custom, nil
		}
	}

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
			found, foundPath = ttf, path
			return filepath.SkipAll
		})
		if found != nil {
			return found, foundPath, true
		}
	}
	return nil, "", false
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
