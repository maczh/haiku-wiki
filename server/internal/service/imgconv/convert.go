// Package imgconv 把各种图片格式归一化成「标准尺寸预览图 + 缩略图」。
//
// 图片库（doc_type=gallery）与需求原型（doc_type=prototype）共用这一层：
// 上传原件永远保留（可下载），另外派生两张小图供相册网格与灯箱使用。
//
// 处理策略是**混合降级**（与 DWG 的两级策略同构）：
//  1. 原生解码（纯 Go）：jpg/png/gif/webp/tiff/bmp —— 无外部依赖，任何环境都可用；
//  2. 矢量直通：svg 不栅格化，预览/缩略图直接复用原文件（浏览器自己缩放，且清晰度无损）；
//  3. 外部转换器：heic/heif/psd/cdr/ai —— 纯 Go 解不了，优先 heif-convert（HEIC 专用），
//     其次 ImageMagick（magick / convert）；两者都没有就**降级**：
//     不生成预览，只保留原件下载，并在 Note 里说明原因。
//
// 降级不是失败：图片库依然可用（用户能看到文件名、大小与下载按钮），
// 只是相册里那张图显示为占位卡。
package imgconv

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	// 标准库只注册了 jpeg/png/gif，其余常用格式在这里补齐（副作用导入）。
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

const (
	// PreviewMax 预览图最长边（相册点开看的那张）。
	PreviewMax = 1600
	// ThumbMax 缩略图最长边（相册网格里那张）。
	ThumbMax = 400
	// JPEGQuality 派生图编码质量。82 是「看不出压缩痕迹 / 体积仍可控」的常用平衡点。
	JPEGQuality = 82
	// maxPixels 解码上限（约 80MP）。超过就拒绝，避免畸形 TIFF 把内存吃光。
	maxPixels = 80_000_000
)

// Result 一次转换的产物。
type Result struct {
	Preview       []byte // JPEG 预览图（最长边 ≤ PreviewMax）；ReuseOriginal 时为空
	Thumb         []byte // JPEG 缩略图（最长边 ≤ ThumbMax）；ReuseOriginal 时为空
	Width         int    // 原图宽（未知时为 0）
	Height        int    // 原图高（未知时为 0）
	Degraded      bool   // true = 没能生成派生图，只能保留原件
	Note          string // 降级原因 / 处理说明，直接给用户看
	ReuseOriginal bool   // true = 矢量图，预览与缩略图直接用原文件 URL
}

// 可被 Go 原生解码的位图格式。
var nativeExt = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
	".webp": true, ".bmp": true, ".tif": true, ".tiff": true,
}

// 矢量格式：不栅格化，直接复用原文件（浏览器按容器尺寸缩放，永不失真）。
var vectorExt = map[string]bool{".svg": true}

// 必须依赖外部转换器的格式。
var externalExt = map[string]bool{
	".heic": true, ".heif": true, ".psd": true, ".cdr": true, ".ai": true,
}

// AllowedExt 图片库/原型允许上传的扩展名白名单。
func AllowedExt() map[string]bool {
	out := make(map[string]bool, len(nativeExt)+len(vectorExt)+len(externalExt))
	for k := range nativeExt {
		out[k] = true
	}
	for k := range vectorExt {
		out[k] = true
	}
	for k := range externalExt {
		out[k] = true
	}
	return out
}

// IsAllowed 扩展名（带点，小写）是否在白名单内。
func IsAllowed(ext string) bool { return AllowedExt()[strings.ToLower(ext)] }

// ---------- 转换入口 ----------

// Convert 按扩展名分派；不认识的格式返回错误（调用方应在上传前用白名单拦掉）。
func Convert(data []byte, filename string) (*Result, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch {
	case vectorExt[ext]:
		return svgResult(data)
	case nativeExt[ext]:
		return native(data)
	case externalExt[ext]:
		return external(data, ext)
	default:
		return nil, fmt.Errorf("不支持的图片格式: %s", ext)
	}
}

// ---------- 原生路径 ----------

func native(data []byte) (*Result, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("无法解析图片: %w", err)
	}
	if cfg.Width*cfg.Height > maxPixels {
		return nil, errors.New("图片尺寸过大（超过 8000 万像素）")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("无法解码图片: %w", err)
	}
	pv, err := encodeJPEG(resize(src, PreviewMax))
	if err != nil {
		return nil, err
	}
	tb, err := encodeJPEG(resize(src, ThumbMax))
	if err != nil {
		return nil, err
	}
	return &Result{
		Preview: pv,
		Thumb:   tb,
		Width:   src.Bounds().Dx(),
		Height:  src.Bounds().Dy(),
	}, nil
}

// resize 等比缩放到「最长边 ≤ max」，并在白底上压平透明通道。
//
// 为什么要压平：PNG/WebP/GIF 常带 alpha，直接编 JPEG 会把透明区变成黑块。
// 相册是白底卡片，压到白底上与观感一致，也顺带把派生图统一成 JPEG（体积小得多）。
func resize(src image.Image, max int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	long := w
	if h > long {
		long = h
	}
	if long <= max || long == 0 {
		return flatten(src, image.Rect(0, 0, w, h))
	}
	nw := w * max / long
	nh := h * max / long
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	// CatmullRom（双三次）：缩放后的文字与线条边缘明显优于最近邻/双线性。
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	return dst
}

func flatten(src image.Image, r image.Rectangle) *image.RGBA {
	dst := image.NewRGBA(r)
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), src, src.Bounds().Min, draw.Over)
	return dst
}

func encodeJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: JPEGQuality}); err != nil {
		return nil, fmt.Errorf("编码预览图失败: %w", err)
	}
	return buf.Bytes(), nil
}

// ---------- SVG 直通 ----------

var (
	svgViewBoxRe = regexp.MustCompile(`viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)`)
	svgWidthRe   = regexp.MustCompile(`\bwidth\s*=\s*["']\s*([\d.]+)`)
	svgHeightRe  = regexp.MustCompile(`\bheight\s*=\s*["']\s*([\d.]+)`)
)

func svgResult(data []byte) (*Result, error) {
	// 只扫头部即可：width/height/viewBox 一定在根元素上，没必要解析整份 XML
	head := data
	if len(head) > 8192 {
		head = head[:8192]
	}
	w, h := 0, 0
	if m := svgViewBoxRe.FindSubmatch(head); m != nil {
		w, h = atoi(string(m[1])), atoi(string(m[2]))
	}
	if m := svgWidthRe.FindSubmatch(head); m != nil {
		if v := atoi(string(m[1])); v > 0 {
			w = v
		}
	}
	if m := svgHeightRe.FindSubmatch(head); m != nil {
		if v := atoi(string(m[1])); v > 0 {
			h = v
		}
	}
	return &Result{Width: w, Height: h, ReuseOriginal: true, Note: "矢量图，直接展示原文件"}, nil
}

func atoi(s string) int {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return int(v)
}

// ---------- 外部转换器 ----------

var (
	convOnce   sync.Once
	convPath   string
	heifOnce   sync.Once
	heifPath   string
	heifFound  bool
	lookupPath = exec.LookPath // 测试可替身
)

// Converter 返回可用的通用图片转换器绝对路径（magick / convert），未安装时为空。
//
// 查找顺序：环境变量 IMAGE_CONVERTER（显式指定，便于自定义构建）→ PATH 里的 magick → convert。
// 结果用 sync.Once 缓存：每次上传都 LookPath 一遍是纯浪费。
func Converter() string {
	convOnce.Do(func() {
		if p := strings.TrimSpace(os.Getenv("IMAGE_CONVERTER")); p != "" {
			if isExecutable(p) {
				convPath = p
				return
			}
		}
		for _, name := range []string{"magick", "convert"} {
			if p, err := lookupPath(name); err == nil && isExecutable(p) {
				convPath = p
				return
			}
		}
	})
	return convPath
}

// HeifConverter 返回 heif-convert（libheif-tools）路径；HEIC 走它比走 ImageMagick 更可靠
// ——  alpine 的 ImageMagick 常未编译 heif delegate，而 libheif-tools 是官方解码器。
func HeifConverter() string {
	heifOnce.Do(func() {
		if p, err := lookupPath("heif-convert"); err == nil && isExecutable(p) {
			heifPath, heifFound = p, true
			return
		}
		heifFound = false
	})
	return heifPath
}

// ResetConverterCache 清空查找缓存（测试用：装/卸转换器后重新探测）。
func ResetConverterCache() {
	convOnce = sync.Once{}
	convPath = ""
	heifOnce = sync.Once{}
	heifPath = ""
	heifFound = false
}

func isExecutable(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Mode()&0o111 != 0
}

func external(data []byte, ext string) (*Result, error) {
	dir, err := os.MkdirTemp("", "imgconv")
	if err != nil {
		return degraded("无法创建临时目录"), nil
	}
	defer os.RemoveAll(dir)

	in := filepath.Join(dir, "in"+ext)
	if err := os.WriteFile(in, data, 0o600); err != nil {
		return degraded("无法写入临时文件"), nil
	}

	// HEIC/HEIF：先试专用解码器（转成 PNG 后走原生路径，尺寸与质量都可控）
	if (ext == ".heic" || ext == ".heif") && HeifConverter() != "" {
		out := filepath.Join(dir, "in.png")
		if err := exec.Command(HeifConverter(), in, out).Run(); err == nil {
			if pngData, err := os.ReadFile(out); err == nil && len(pngData) > 0 {
				if r, err := native(pngData); err == nil {
					return r, nil
				}
			}
		}
	}

	conv := Converter()
	if conv == "" {
		return degraded("未安装图片转换器，HEIC/PSD/CDR/AI 等格式无法生成预览"), nil
	}
	pvPath := filepath.Join(dir, "preview.jpg")
	tbPath := filepath.Join(dir, "thumb.jpg")
	// in[0]：PSD/HEIC 这类多图层/多帧格式只取第一层，否则 ImageMagick 会吐出一堆文件。
	// -background white -alpha remove：把透明通道压平（JPEG 不支持 alpha）。
	// -strip：丢掉 EXIF/ICC 等元数据，派生图不需要它们。
	base := []string{in + "[0]", "-background", "white", "-alpha", "remove", "-strip"}
	if err := exec.Command(conv, append(base, "-resize", fmt.Sprintf("%dx%d>", PreviewMax, PreviewMax),
		"-quality", strconv.Itoa(JPEGQuality), pvPath)...).Run(); err != nil {
		return degraded("图片转换失败（格式可能不受支持）"), nil
	}
	if err := exec.Command(conv, append(base, "-resize", fmt.Sprintf("%dx%d>", ThumbMax, ThumbMax),
		"-quality", strconv.Itoa(JPEGQuality), tbPath)...).Run(); err != nil {
		return degraded("缩略图生成失败"), nil
	}
	pv, err1 := os.ReadFile(pvPath)
	tb, err2 := os.ReadFile(tbPath)
	if err1 != nil || err2 != nil || len(pv) == 0 || len(tb) == 0 {
		return degraded("转换结果为空"), nil
	}
	return &Result{Preview: pv, Thumb: tb}, nil
}

func degraded(note string) *Result {
	return &Result{Degraded: true, Note: note}
}

// ---------- 能力上报 ----------

// Capability 当前环境的图片处理能力，供前端在上传前给出提示（与 /api/cad/converter 同构）。
type Capability struct {
	Converter     string   `json:"converter"`      // 通用转换器绝对路径，空=未安装
	HeifConverter string   `json:"heif_converter"` // HEIC 专用解码器，空=未安装
	Native        []string `json:"native_formats"` // 无需外部依赖即可出预览图的格式
	External      []string `json:"external_formats"`
	Vector        []string `json:"vector_formats"` // 直接复用原文件的矢量格式
}

// Capabilities 探测当前环境能力（转换器路径带缓存，调用廉价）。
func Capabilities() Capability {
	return Capability{
		Converter:     Converter(),
		HeifConverter: HeifConverter(),
		Native:        keys(nativeExt),
		External:      keys(externalExt),
		Vector:        keys(vectorExt),
	}
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, strings.TrimPrefix(k, "."))
	}
	sortStrings(out)
	return out
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
