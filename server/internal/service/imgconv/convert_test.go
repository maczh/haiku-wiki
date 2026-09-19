package imgconv

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// ---------- 夹具：程序化生成，避免把二进制图片塞进仓库 ----------

func pngFixture(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func jpegFixture(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func gifFixture(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewPaletted(image.Rect(0, 0, w, h), color.Palette{color.White, color.Black})
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetColorIndex(x, y, uint8((x+y)%2))
		}
	}
	var buf bytes.Buffer
	if err := gif.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func dims(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("派生图无法解码: %v", err)
	}
	return cfg.Width, cfg.Height
}

// ---------- 原生路径 ----------

func TestConvertNativeSizes(t *testing.T) {
	cases := []struct {
		name string
		file string
		data []byte
	}{
		{"png", "a.png", pngFixture(t, 2400, 1200, color.RGBA{R: 200, G: 30, B: 30, A: 255})},
		{"jpeg", "b.jpg", jpegFixture(t, 3000, 1000)},
		{"gif", "c.gif", gifFixture(t, 1200, 2400)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res, err := Convert(c.data, c.file)
			if err != nil {
				t.Fatalf("转换失败: %v", err)
			}
			if res.Degraded || res.ReuseOriginal {
				t.Fatalf("原生格式不应降级/直通: %+v", res)
			}
			pw, ph := dims(t, res.Preview)
			tw, th := dims(t, res.Thumb)
			// 预览：最长边恰好 1600，短边按比例
			if max := maxOf(pw, ph); max != PreviewMax {
				t.Fatalf("预览最长边应为 %d, got %dx%d", PreviewMax, pw, ph)
			}
			// 缩略图：最长边恰好 400
			if max := maxOf(tw, th); max != ThumbMax {
				t.Fatalf("缩略图最长边应为 %d, got %dx%d", ThumbMax, tw, th)
			}
			// 宽高比保持（允许 1px 取整误差）
			if abs(pw*ph/1000-tw*ph/1000) > 1000 {
				t.Fatalf("宽高比失真: %dx%d vs %dx%d", pw, ph, tw, th)
			}
			// 原图尺寸如实上报
			if res.Width == 0 || res.Height == 0 {
				t.Fatalf("应上报原图尺寸: %+v", res)
			}
		})
	}
}

// 小图不放大：本来就没到标准尺寸，拉上去只会糊。
func TestConvertDoesNotUpscale(t *testing.T) {
	res, err := Convert(pngFixture(t, 300, 200, color.RGBA{A: 255}), "small.png")
	if err != nil {
		t.Fatal(err)
	}
	pw, ph := dims(t, res.Preview)
	if pw != 300 || ph != 200 {
		t.Fatalf("小图应保持原尺寸, got %dx%d", pw, ph)
	}
}

// 透明通道必须压到白底：PNG/WebP/GIF 常带 alpha，直接编 JPEG 会把透明区变黑块。
func TestAlphaFlattenedToWhite(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 100, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 100; x++ {
			img.SetRGBA(x, y, color.RGBA{R: 255, G: 0, B: 0, A: 0}) // 全透明红
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	res, err := Convert(buf.Bytes(), "alpha.png")
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := image.Decode(bytes.NewReader(res.Thumb))
	if err != nil {
		t.Fatal(err)
	}
	r, g, b, _ := got.At(50, 50).RGBA()
	if r>>8 < 240 || g>>8 < 240 || b>>8 < 240 {
		t.Fatalf("透明区应压成白底, got rgb(%d,%d,%d)", r>>8, g>>8, b>>8)
	}
}

// ---------- SVG 直通 ----------

func TestConvertSVGReusesOriginal(t *testing.T) {
	svg := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="10" height="10"/></svg>`)
	res, err := Convert(svg, "logo.svg")
	if err != nil {
		t.Fatal(err)
	}
	if !res.ReuseOriginal {
		t.Fatal("SVG 应走直通（不栅格化）")
	}
	if len(res.Preview) != 0 || len(res.Thumb) != 0 {
		t.Fatal("直通时不应生成派生图")
	}
	if res.Width != 800 || res.Height != 600 {
		t.Fatalf("应解析出尺寸 800x600, got %dx%d", res.Width, res.Height)
	}
}

// ---------- 降级路径 ----------

// 没有外部转换器时：HEIC/PSD/AI 等不能失败，而是降级——保留原件、给出原因。
func TestConvertDegradesWithoutConverter(t *testing.T) {
	orig := lookupPath
	lookupPath = func(string) (string, error) { return "", errors.New("no such binary") }
	t.Setenv("IMAGE_CONVERTER", "")
	ResetConverterCache()
	t.Cleanup(func() {
		lookupPath = orig
		ResetConverterCache()
	})

	for _, f := range []string{"photo.heic", "design.psd", "logo.ai", "x.cdr"} {
		res, err := Convert([]byte("not-a-real-image"), f)
		if err != nil {
			t.Fatalf("%s 不应返回错误（应降级）: %v", f, err)
		}
		if !res.Degraded {
			t.Fatalf("%s 应标记为降级", f)
		}
		if res.Note == "" {
			t.Fatalf("%s 降级时应给出原因", f)
		}
		if len(res.Preview) != 0 || len(res.Thumb) != 0 {
			t.Fatalf("%s 降级时不应产出派生图", f)
		}
	}
	if Converter() != "" {
		t.Fatalf("无转换器时 Converter() 应为空, got %q", Converter())
	}
}

// 显式指定 IMAGE_CONVERTER 时优先使用它（便于自定义构建/离线部署）。
func TestConverterFromEnv(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "my-magick")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("IMAGE_CONVERTER", fake)
	ResetConverterCache()
	t.Cleanup(func() {
		t.Setenv("IMAGE_CONVERTER", "")
		ResetConverterCache()
	})
	if Converter() != fake {
		t.Fatalf("应优先使用 IMAGE_CONVERTER, got %q", Converter())
	}
	// 路径无效（文件不存在）时不能把它当成可用
	t.Setenv("IMAGE_CONVERTER", filepath.Join(dir, "nope"))
	ResetConverterCache()
	if Converter() != "" {
		t.Fatalf("不存在的路径应被忽略, got %q", Converter())
	}
}

// ---------- 白名单与能力上报 ----------

func TestAllowedExtCoversRequiredFormats(t *testing.T) {
	need := []string{".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".webp", ".heic", ".svg", ".psd", ".cdr", ".ai"}
	for _, e := range need {
		if !IsAllowed(e) {
			t.Fatalf("%s 应在白名单内", e)
		}
	}
	if IsAllowed(".exe") || IsAllowed(".php") {
		t.Fatal("非图片格式不应被放行")
	}
}

func TestConvertRejectsUnknownExt(t *testing.T) {
	if _, err := Convert([]byte("x"), "evil.exe"); err == nil {
		t.Fatal("未知格式应报错")
	}
}

func TestCapabilitiesReport(t *testing.T) {
	c := Capabilities()
	if len(c.Native) == 0 || len(c.External) == 0 || len(c.Vector) == 0 {
		t.Fatalf("能力清单不应为空: %+v", c)
	}
	// 清单里的格式必须都在白名单里（否则前端会提示用户上传一个后端不认的格式）
	for _, list := range [][]string{c.Native, c.External, c.Vector} {
		for _, e := range list {
			if !IsAllowed("." + e) {
				t.Fatalf("%s 出现在能力清单但不在白名单", e)
			}
		}
	}
}

// ---------- 小工具 ----------

func maxOf(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
