package exportx

// DWG → 矢量/栅格预览。
//
// DWG 是 AutoCAD 的专有二进制格式，纯 Go 无法解析。这里提供两级方案：
//
//	第 1 级：外部转换器把 DWG 转成 DXF，再交给本项目自己的 DXF 渲染器
//	         （矢量还原，质量最好）。支持 libredwg 的 dwg2dxf / dwgread，
//	         以及 ODA File Converter，也可用 EXPORT_DWG_CONVERTER 指定。
//	第 2 级：兜底。AutoCAD 默认会在 DWG 头部写入一张缩略图（预览位图），
//	         直接把它抽出来当 PNG 用。分辨率低、不含矢量信息，但能让
//	         没有安装转换器的环境下依然"看得见图"，并在结果里标记为降级预览。
//
// 两级都不可用时返回可操作的错误信息（告诉用户装什么）。

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/image/bmp"
)

// TempDir 转换器使用的临时目录。
// 由 service 层在启动时设为 DataDir/tmp —— 不能依赖系统 /tmp，
// 容器与部分环境里 /tmp 是容量很小的 tmpfs，放不下 DWG。
var TempDir string

// CadConversion DWG 转换结果。
type CadConversion struct {
	SVG      []byte
	PNG      []byte
	Degraded bool   // true：仅为内嵌预览位图，未做矢量还原
	Note     string // 降级原因 / 转换器信息（供前端提示与排障）
}

// ---------- 外部转换器发现 ----------

type dwgConverter struct {
	name string
	// args 返回执行参数；out 为期望的输出文件路径
	args func(in, out string) []string
	// folder 为 true 表示该转换器是"目录进目录出"（ODA File Converter）
	folder bool
}

// builtinConverters 按优先级排列的已知转换器。
var builtinConverters = []dwgConverter{
	{name: "dwg2dxf", args: func(in, out string) []string { return []string{"-o", out, in} }},
	{name: "dwgread", args: func(in, out string) []string { return []string{"-O", "DXF", "-o", out, in} }},
	{name: "ODAFileConverter", folder: true},
}

var (
	convOnce sync.Once
	convPath string
	convKind string
)

// findDWGConverter 定位 DWG → DXF 转换器；空字符串表示不可用。
//
// 优先级：EXPORT_DWG_CONVERTER 环境变量 > PATH 中的已知转换器。
// 结果缓存，避免每次导入都做一次 PATH 扫描。
func findDWGConverter() (path, kind string) {
	convOnce.Do(func() {
		if env := strings.TrimSpace(os.Getenv("EXPORT_DWG_CONVERTER")); env != "" {
			if p, err := exec.LookPath(env); err == nil {
				convPath, convKind = p, detectKind(p)
				return
			}
		}
		for _, c := range builtinConverters {
			if p, err := exec.LookPath(c.name); err == nil {
				convPath, convKind = p, c.name
				return
			}
		}
	})
	return convPath, convKind
}

// detectKind 以可执行文件名判定调用约定（env 覆盖时用）。
func detectKind(path string) string {
	base := strings.ToLower(filepath.Base(path))
	switch {
	case strings.Contains(base, "oda"):
		return "ODAFileConverter"
	case strings.Contains(base, "dwgread"):
		return "dwgread"
	default:
		return "dwg2dxf"
	}
}

// DWGConverterAvailable 报告是否存在可用的外部 DWG → DXF 转换器。
// 为 false 时仍能导入 DWG（走内嵌预览图降级），只是没有矢量还原。
func DWGConverterAvailable() bool {
	p, _ := findDWGConverter()
	return p != ""
}

// DWGConverterStatus 返回转换器状态描述（供诊断接口/日志）。
func DWGConverterStatus() string {
	p, k := findDWGConverter()
	if p == "" {
		return "未找到 DWG 转换器（将使用内嵌预览位图降级方案）" + converterBuildHint()
	}
	return fmt.Sprintf("已启用 %s（%s）", k, p)
}

// converterBuildHint 读取构建期留下的转换器状态文件，给出「为什么没有转换器」的线索。
//
// 背景：镜像里转换器的有无取决于镜像构建阶段能否编译出 libredwg。该阶段失败时
// 出于「不让镜像构建整体失败」的考虑不会中断，于是运行期只会看到「未安装转换器」——
// 使用者无从判断是漏装依赖、网络拉不到源码，还是别的原因。Dockerfile 会把失败日志
// 写进 converter-status.txt 一起带进镜像，这里把它读出来附在状态里。
func converterBuildHint() string {
	path := strings.TrimSpace(os.Getenv("EXPORT_DWG_BUILD_STATUS"))
	if path == "" {
		path = "/usr/local/bin/converter-status.txt"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	msg := strings.TrimSpace(string(data))
	if msg == "" || strings.HasPrefix(msg, "ok ") {
		return ""
	}
	// 只取前几行，避免把整段编译日志塞进接口响应。
	lines := strings.Split(msg, "\n")
	if len(lines) > 3 {
		lines = append(lines[:3], "…")
	}
	return "；镜像构建期信息：" + strings.Join(lines, " / ")
}

// ResetDWGConverterCache 清除转换器发现缓存（测试用）。
func ResetDWGConverterCache() {
	convOnce = sync.Once{}
	convPath, convKind = "", ""
}

// DWGToDXF 调用外部转换器把 DWG 转为 DXF 字节。
func DWGToDXF(dwg []byte) ([]byte, error) {
	path, kind := findDWGConverter()
	if path == "" {
		return nil, fmt.Errorf("未安装 DWG 转换器")
	}
	dir, err := makeTempDir("dwg")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)

	in := filepath.Join(dir, "input.dwg")
	if err := os.WriteFile(in, dwg, 0o600); err != nil {
		return nil, fmt.Errorf("写入临时文件失败：%v", err)
	}

	if kind == "ODAFileConverter" {
		return runODAConverter(path, dir)
	}
	out := filepath.Join(dir, "output.dxf")
	var args []string
	for _, c := range builtinConverters {
		if c.name == kind && !c.folder {
			args = c.args(in, out)
			break
		}
	}
	if args == nil {
		args = []string{"-o", out, in}
	}
	cmd := exec.Command(path, args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	// 产物优先于退出码：libredwg 在遇到它自己能跳过的告警（Unstable / Unhandled Class
	// 之类）时仍可能返回非 0，而 DXF 是完整可用的。若只看退出码就丢弃产物，
	// 大批真实图纸会白白退化成低分辨率位图预览。只在「产物确实是 DXF」时才采信。
	data, readErr := os.ReadFile(out)
	if readErr == nil && looksLikeDXF(data) {
		return data, nil
	}
	if runErr != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = runErr.Error()
		}
		return nil, fmt.Errorf("%s 转换失败：%s", kind, truncate(msg, 300))
	}
	return nil, fmt.Errorf("%s 未产出 DXF（可能是该 DWG 版本不受支持）", kind)
}

// looksLikeDXF 粗判字节流是否像一份 DXF（用于「退出码非 0 但产物可用」的采信闸门）。
// 真正的结构校验交给 ParseDXF，这里只要排除掉空文件与明显的垃圾输出。
func looksLikeDXF(data []byte) bool {
	if len(data) < 32 {
		return false
	}
	head := data
	if len(head) > 4096 {
		head = head[:4096]
	}
	return bytes.Contains(head, []byte("SECTION"))
}

// runODAConverter ODA File Converter 是目录进目录出的批处理工具。
func runODAConverter(path, dir string) ([]byte, error) {
	inDir := filepath.Join(dir, "in")
	outDir := filepath.Join(dir, "out")
	if err := os.MkdirAll(inDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Rename(filepath.Join(dir, "input.dwg"), filepath.Join(inDir, "input.dwg")); err != nil {
		return nil, err
	}
	// ODAFileConverter <inDir> <outDir> <outVer> <outFormat> <recurse> <audit> [inputFilter]
	cmd := exec.Command(path, inDir, outDir, "ACAD2018", "DXF", "0", "1", "*.DWG")
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ODAFileConverter 转换失败：%s", truncate(strings.TrimSpace(stderr.String()), 300))
	}
	entries, _ := os.ReadDir(outDir)
	for _, e := range entries {
		if strings.EqualFold(filepath.Ext(e.Name()), ".dxf") {
			return os.ReadFile(filepath.Join(outDir, e.Name()))
		}
	}
	return nil, fmt.Errorf("ODAFileConverter 未产出 DXF")
}

// ConvertCad 按扩展名把 CAD 文件转成 SVG + PNG 预览。
// ext 支持 dwg（走外部转换器或内嵌预览图）与 dxf（直接解析，无需外部工具）。
// degraded 为真表示结果是降级预览（低分辨率位图），note 为过程说明。
func ConvertCad(raw []byte, ext string) (svg, pngData []byte, degraded bool, note string, err error) {
	switch strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), ".")) {
	case "dxf":
		d, perr := ParseDXF(raw)
		if perr != nil {
			return nil, nil, false, "", perr
		}
		svg, err = BuildCadSVG(d)
		if err != nil {
			return nil, nil, false, "", err
		}
		pngData, err = BuildCadPNG(d)
		if err != nil {
			return nil, nil, false, "", err
		}
		return svg, pngData, false, fmt.Sprintf("已解析 DXF（图元 %d 条）", len(d.Polylines)), nil
	case "dwg":
		c, cerr := ConvertDWG(raw)
		if cerr != nil {
			return nil, nil, false, "", cerr
		}
		return c.SVG, c.PNG, c.Degraded, c.Note, nil
	}
	return nil, nil, false, "", fmt.Errorf("不支持的 CAD 扩展名：%s", ext)
}

// ConvertDWG 把 DWG 转成 SVG + PNG 预览。
func ConvertDWG(dwg []byte) (*CadConversion, error) {
	dwg = bytes.TrimSpace(dwg)
	if len(dwg) < 8 {
		return nil, fmt.Errorf("DWG 文件内容过短，可能已损坏")
	}
	path, _ := findDWGConverter()
	if path != "" {
		dxf, err := DWGToDXF(dwg)
		if err == nil {
			if d, perr := ParseDXF(dxf); perr == nil {
				svg, err := BuildCadSVG(d)
				if err != nil {
					return nil, err
				}
				pngData, err := BuildCadPNG(d)
				if err != nil {
					return nil, err
				}
				return &CadConversion{
					SVG:  svg,
					PNG:  pngData,
					Note: fmt.Sprintf("已通过 %s 矢量还原（图元 %d 条）", filepath.Base(path), len(d.Polylines)),
				}, nil
			}
		}
		// 转换器存在但失败：继续尝试降级方案，把原因记录下来
		if c, derr := embeddedPreviewConversion(dwg); derr == nil {
			c.Note = "转换器不可用（" + truncate(err.Error(), 160) + "），已使用文件内嵌预览图降级显示"
			return c, nil
		} else {
			return nil, err
		}
	}
	c, err := embeddedPreviewConversion(dwg)
	if err != nil {
		return nil, fmt.Errorf("%s%s", "未安装 DWG 转换器，且文件内不含预览图。"+
			"请安装 libredwg（提供 dwg2dxf）或通过 EXPORT_DWG_CONVERTER 指定转换器", converterBuildHint())
	}
	return c, nil
}

// embeddedPreviewConversion 抽取 DWG 头部内嵌的预览位图作为降级预览。
//
// 实现方式：在文件前 64KB 内查找 PNG / BMP 魔数，取首个可成功解码者。
// 预览图固定在文件头部区域，因此"取首个"能避开正文中零散的嵌入图像。
func embeddedPreviewConversion(dwg []byte) (*CadConversion, error) {
	img, err := extractEmbeddedPreview(dwg)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("预览图编码失败：%v", err)
	}
	b := img.Bounds()
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`+
		`<rect width="100%%" height="100%%" fill="#ffffff"/>`+
		`<image width="%d" height="%d" href="data:image/png;base64,%s"/></svg>`,
		b.Dx(), b.Dy(), b.Dx(), b.Dy(), b.Dx(), b.Dy(), base64.StdEncoding.EncodeToString(buf.Bytes()))
	return &CadConversion{
		SVG:      []byte(svg),
		PNG:      buf.Bytes(),
		Degraded: true,
		Note:     "使用 DWG 内嵌预览图（低分辨率位图）。安装 libredwg 后可获得矢量还原效果",
	}, nil
}

// extractEmbeddedPreview 在文件头部区域寻找并解码预览位图。
//
// 三种形态都要覆盖：内嵌 PNG、带文件头的 BMP（以 "BM" 开头）、
// 以及**只有 BITMAPINFOHEADER 没有 "BM" 的无文件头 BMP**。
// 最后一种不能靠魔数查找（它没有 "BM"），只能按头部字段的合法性做受控扫描 ——
// 早期版本把无文件头形态写成「按 BM 找」，导致该分支实际不可达：凡是只存
// BITMAPINFOHEADER 的图纸都会被判成「不含预览图」，把有救的文件判死。
func extractEmbeddedPreview(dwg []byte) (image.Image, error) {
	limit := len(dwg)
	if limit > 96<<10 {
		limit = 96 << 10
	}
	head := dwg[:limit]
	pngMagic := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	if i := bytes.Index(head, pngMagic); i >= 0 {
		if img, err := png.Decode(bytes.NewReader(dwg[i:])); err == nil {
			return img, nil
		}
	}
	// BMP：DWG 里常见两种形态 —— 带 14 字节文件头，或不带文件头（仅 BITMAPINFOHEADER）
	if i := bytes.Index(head, []byte("BM")); i >= 0 && i+18 < len(dwg) {
		raw := dwg[i:]
		if img, err := bmp.Decode(bytes.NewReader(raw)); err == nil {
			return img, nil
		}
		if img, err := decodeHeaderlessBMP(raw); err == nil {
			return img, nil
		}
	}
	// 无文件头形态：没有 "BM" 可供检索，改为按 BITMAPINFOHEADER 字段的合法性扫描。
	// 校验很严（biSize / planes / bpp / compression / 尺寸范围），且必须整体解码成功才采用，
	// 以尽量避免把正文数据误判成位图；预览图固定在文件头部，故取首个命中即可。
	for i := 0; i+40 <= len(head); i++ {
		biSize := binary.LittleEndian.Uint32(head[i : i+4])
		if biSize != 40 && biSize != 108 && biSize != 124 {
			continue
		}
		w := int32(binary.LittleEndian.Uint32(head[i+4 : i+8]))
		h := int32(binary.LittleEndian.Uint32(head[i+8 : i+12]))
		planes := binary.LittleEndian.Uint16(head[i+12 : i+14])
		bpp := binary.LittleEndian.Uint16(head[i+14 : i+16])
		comp := binary.LittleEndian.Uint32(head[i+16 : i+20])
		if planes != 1 || comp > 3 {
			continue
		}
		switch bpp {
		case 1, 4, 8, 16, 24, 32:
		default:
			continue
		}
		if w < 0 {
			w = -w
		}
		if h < 0 {
			h = -h
		}
		if w < 8 || h < 8 || w > 20000 || h > 20000 {
			continue
		}
		if img, err := decodeHeaderlessBMP(dwg[i:]); err == nil {
			return img, nil
		}
	}
	return nil, fmt.Errorf("未找到可用的内嵌预览图")
}

// decodeHeaderlessBMP 给缺失文件头的 BITMAPINFOHEADER 补一个 BMP 文件头后解码。
func decodeHeaderlessBMP(raw []byte) (image.Image, error) {
	if len(raw) < 40 {
		return nil, fmt.Errorf("BMP 数据过短")
	}
	headerSize := binary.LittleEndian.Uint32(raw[0:4])
	if headerSize < 40 || headerSize > 124 {
		return nil, fmt.Errorf("非 BITMAPINFOHEADER")
	}
	offBits := uint32(14) + headerSize
	fileSize := uint32(len(raw)) + 14
	buf := make([]byte, 0, len(raw)+14)
	buf = append(buf, 'B', 'M')
	buf = binary.LittleEndian.AppendUint32(buf, fileSize)
	buf = binary.LittleEndian.AppendUint16(buf, 0)
	buf = binary.LittleEndian.AppendUint16(buf, 0)
	buf = binary.LittleEndian.AppendUint32(buf, offBits)
	buf = append(buf, raw...)
	return bmp.Decode(bytes.NewReader(buf))
}

// ---------- 内部工具 ----------

func makeTempDir(prefix string) (string, error) {
	base := TempDir
	if base != "" {
		if err := os.MkdirAll(base, 0o700); err != nil {
			return "", fmt.Errorf("创建临时目录失败：%v", err)
		}
	}
	dir, err := os.MkdirTemp(base, "hk-"+prefix+"-")
	if err != nil {
		return "", fmt.Errorf("创建临时目录失败：%v", err)
	}
	return dir, nil
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
