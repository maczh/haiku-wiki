package exportx

// DWG 降级路径（内嵌预览位图）的单元测试。
//
// 为什么需要它：真实图纸夹具（libredwg 的 test-data）都是工具转换生成的，**不含**内嵌缩略图，
// 因此真实夹具只能覆盖「矢量还原」一条路径；而生产环境里没有装 dwg2dxf 是常态，
// 用户遇到的恰恰是降级分支。这里用**合成 DWG**（头部 + 内嵌 PNG / 无文件头 BMP）把该分支锁住。
//
// 同时锁定「既无转换器又无内嵌预览图」时的诚实报错：必须告诉用户怎么补救，
// 而不是抛一个看不懂的解析错误。

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

// withoutDWGConverter 强制让转换器发现逻辑返回「不可用」，保证测试不受本机环境影响。
func withoutDWGConverter(t *testing.T) {
	t.Helper()
	t.Setenv("EXPORT_DWG_CONVERTER", "")
	t.Setenv("PATH", "/nonexistent") // 掐掉 PATH 查找，避免本机装了 dwg2dxf 时结果漂移
	ResetDWGConverterCache()
	t.Cleanup(ResetDWGConverterCache)
	if DWGConverterAvailable() {
		t.Fatal("未能屏蔽 DWG 转换器，降级用例将失去意义")
	}
}

// fakeDWG 拼一个「像 DWG」的文件：AC1027 标识 + 头部填充 + 追加的载荷。
// extractEmbeddedPreview 只在前 96KB 内按魔数找图，所以这里不必构造合法 DWG 结构。
func fakeDWG(payloads ...[]byte) []byte {
	var buf bytes.Buffer
	buf.WriteString("AC1027")
	buf.Write(make([]byte, 256)) // 头部填充
	for _, p := range payloads {
		buf.Write(p)
		buf.Write(make([]byte, 32))
	}
	return buf.Bytes()
}

// samplePNG 生成一张可辨识的小图，用于验证「抽出来的确实是这张图」。
func samplePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 20), G: uint8(y * 20), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("构造夹具失败：%v", err)
	}
	return buf.Bytes()
}

// headerlessBMP24 构造「只有 BITMAPINFOHEADER、没有 BMP 文件头」的载荷 —— DWG 里常见的形态。
func headerlessBMP24(w, h int) []byte {
	stride := ((w*3 + 3) / 4) * 4
	px := make([]byte, stride*h)
	for i := range px {
		px[i] = byte((i * 7) % 256)
	}
	b := make([]byte, 0, 40+len(px))
	b = binary.LittleEndian.AppendUint32(b, 40) // biSize = BITMAPINFOHEADER
	b = binary.LittleEndian.AppendUint32(b, uint32(w))
	b = binary.LittleEndian.AppendUint32(b, uint32(h))
	b = binary.LittleEndian.AppendUint16(b, 1)  // planes
	b = binary.LittleEndian.AppendUint16(b, 24) // bpp
	b = binary.LittleEndian.AppendUint32(b, 0)  // BI_RGB
	b = binary.LittleEndian.AppendUint32(b, uint32(len(px)))
	b = binary.LittleEndian.AppendUint32(b, 2835)
	b = binary.LittleEndian.AppendUint32(b, 2835)
	b = binary.LittleEndian.AppendUint32(b, 0)
	b = binary.LittleEndian.AppendUint32(b, 0)
	return append(b, px...)
}

// TestConvertDWGEmbeddedPNGFallback：内嵌 PNG → 降级转换，且 SVG/PNG 都产出。
func TestConvertDWGEmbeddedPNGFallback(t *testing.T) {
	withoutDWGConverter(t)
	TempDir = t.TempDir()

	src := samplePNG(t, 12, 8)
	conv, err := ConvertDWG(fakeDWG(src))
	if err != nil {
		t.Fatalf("有内嵌预览图时不应报错，却得到：%v", err)
	}
	if !conv.Degraded {
		t.Fatal("内嵌位图路径必须标记 Degraded=true，否则界面会把位图当矢量图纸展示")
	}
	if !strings.Contains(conv.Note, "内嵌预览图") {
		t.Errorf("说明文案应点明「内嵌预览图」，实际为：%s", conv.Note)
	}

	// PNG 必须能解码，且尺寸与源图一致
	img, derr := png.Decode(bytes.NewReader(conv.PNG))
	if derr != nil {
		t.Fatalf("派生 PNG 无法解码：%v", derr)
	}
	if b := img.Bounds(); b.Dx() != 12 || b.Dy() != 8 {
		t.Errorf("派生 PNG 尺寸应为 12x8，实际 %dx%d", b.Dx(), b.Dy())
	}

	// SVG 是「位图包进 <image>」的形态 —— 正因如此，界面上**不能**把它标成「矢量预览」
	svg := string(conv.SVG)
	if !strings.Contains(svg, "<image") || !strings.Contains(svg, "data:image/png;base64,") {
		t.Errorf("降级 SVG 应内嵌 base64 位图，实际：%s", truncate(svg, 200))
	}
}

// TestConvertCadDegradedContract：服务层（附件派生）拿到的是同一份契约。
func TestConvertCadDegradedContract(t *testing.T) {
	withoutDWGConverter(t)
	TempDir = t.TempDir()

	svg, pngData, degraded, note, err := ConvertCad(fakeDWG(samplePNG(t, 10, 6)), "dwg")
	if err != nil {
		t.Fatalf("降级路径不应报错：%v", err)
	}
	if !degraded {
		t.Error("degraded 应为 true")
	}
	if len(svg) == 0 || len(pngData) == 0 {
		t.Errorf("降级路径必须同时产出 svg 与 png（长度 svg=%d png=%d）", len(svg), len(pngData))
	}
	if !strings.Contains(note, "内嵌预览图") {
		t.Errorf("note 应说明来源，实际：%s", note)
	}
}

// TestConvertDWGEmbeddedHeaderlessBMPFallback：无文件头 BMP 也要能救回来。
//
// 注意别用 4x4 这种玩具尺寸：抽取器会按「宽高 >= 8」过滤明显不合理的候选，
// 过小的夹具会被当成噪声跳过，看起来像功能坏了。
func TestConvertDWGEmbeddedHeaderlessBMPFallback(t *testing.T) {
	withoutDWGConverter(t)
	TempDir = t.TempDir()

	conv, err := ConvertDWG(fakeDWG(headerlessBMP24(16, 12)))
	if err != nil {
		t.Fatalf("无文件头 BMP 应能解码，却得到：%v", err)
	}
	if !conv.Degraded {
		t.Error("应为降级结果")
	}
	img, derr := png.Decode(bytes.NewReader(conv.PNG))
	if derr != nil {
		t.Fatalf("派生 PNG 无法解码：%v", derr)
	}
	if b := img.Bounds(); b.Dx() != 16 || b.Dy() != 12 {
		t.Errorf("尺寸应为 16x12，实际 %dx%d", b.Dx(), b.Dy())
	}
}

// TestConvertDWGNoConverterNoPreviewIsHonest：既无转换器又无内嵌图 → 报错必须可执行。
func TestConvertDWGNoConverterNoPreviewIsHonest(t *testing.T) {
	withoutDWGConverter(t)
	TempDir = t.TempDir()

	_, err := ConvertDWG(fakeDWG([]byte("just some bytes, no image at all")))
	if err == nil {
		t.Fatal("既无转换器又无预览图时必须报错，否则界面会显示空白图纸且无从排查")
	}
	msg := err.Error()
	if !strings.Contains(msg, "转换器") {
		t.Errorf("错误信息应说明缺少转换器，实际：%s", msg)
	}
	if !strings.Contains(msg, "libredwg") && !strings.Contains(msg, "EXPORT_DWG_CONVERTER") {
		t.Errorf("错误信息应给出补救方式（安装 libredwg 或设 EXPORT_DWG_CONVERTER），实际：%s", msg)
	}
}

// TestExtractEmbeddedPreviewIgnoresFalsePositive：正文里恰好出现 "BM"/PNG 魔数也不能误解码。
func TestExtractEmbeddedPreviewIgnoresFalsePositive(t *testing.T) {
	// "BM" 后面跟的是垃圾数据：两个分支解码都应失败，最终返回错误而不是 panic
	junky := append([]byte("BM"), bytes.Repeat([]byte{0xff}, 64)...)
	if _, err := extractEmbeddedPreview(fakeDWG(junky)); err == nil {
		t.Error("不可解码的 BMP 载荷应被跳过并返回错误")
	}
	// 只有 PNG 魔数、后无有效数据：同样必须失败而不是产出垃圾
	bogus := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0x00}, 32)...)
	if _, err := extractEmbeddedPreview(fakeDWG(bogus)); err == nil {
		t.Error("无效 PNG 载荷应被跳过并返回错误")
	}
}
