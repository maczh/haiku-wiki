package exportx

// DWG 端到端集成测试。
//
// DWG 是专有二进制格式，仓库里无法内置真实图纸夹具，因此本测试默认跳过；
// 需要验证时指向一份真实 DWG 目录（例如 libredwg 源码自带的 test/test-data）：
//
//	exportx.TempDir 需可写，测试内用 t.TempDir() 覆盖。
//
//	DWG_FIXTURE_DIR=/path/to/libredwg/test/test-data \
//	EXPORT_DWG_CONVERTER=/path/to/dwg2dxf \
//	go test ./internal/service/exportx -run TestConvertDWGRealFixtures -v
//
// 设置 DWG_OUT_DIR 可把生成的 SVG/PNG 落盘，便于用 file(1) 或浏览器人工核对。

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// dwgFixtureCases 覆盖各代 DWG 格式（R13 ~ 2018）与典型图元类型。
// 均为 libredwg 项目自带的公开测试图纸。
var dwgFixtureCases = []string{
	"r1.4/entities.dwg",
	"r2.10/block.dwg",
	"example_r13.dwg",
	"example_r14.dwg",
	"example_2000.dwg",
	"example_2004.dwg",
	"example_2007.dwg",
	"example_2010.dwg",
	"example_2013.dwg",
	"example_2018.dwg",
	"sample_2018.dwg",
	"2000/Text.dwg",
	"2000/Polyline.dwg",
	"2000/PolyLine3D.dwg",
	"2010/Leader.dwg",
}

// TestConvertDWGRealFixtures 用真实 DWG 跑通「转换器 → DXF → 矢量 SVG/PNG」全链路。
// 断言重点：必须走矢量还原（而非内嵌位图降级），且产物能被标准解码器解析。
func TestConvertDWGRealFixtures(t *testing.T) {
	fixtureDir := strings.TrimSpace(os.Getenv("DWG_FIXTURE_DIR"))
	if fixtureDir == "" {
		t.Skip("未设置 DWG_FIXTURE_DIR，跳过真实 DWG 端到端测试")
	}
	if !DWGConverterAvailable() {
		t.Fatalf("未发现 DWG 转换器（%s）", DWGConverterStatus())
	}
	t.Logf("转换器状态：%s", DWGConverterStatus())

	TempDir = t.TempDir() // 转换过程的中间文件（DWG/DXF）落在测试临时目录内

	outDir := strings.TrimSpace(os.Getenv("DWG_OUT_DIR"))
	if outDir != "" {
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			t.Fatalf("创建输出目录失败：%v", err)
		}
	}

	passed := 0
	for _, rel := range dwgFixtureCases {
		rel := rel
		t.Run(strings.ReplaceAll(rel, "/", "_"), func(t *testing.T) {
			path := filepath.Join(fixtureDir, filepath.FromSlash(rel))
			raw, err := os.ReadFile(path)
			if os.IsNotExist(err) {
				t.Skipf("夹具不存在：%s", path)
			}
			if err != nil {
				t.Fatalf("读取夹具失败：%v", err)
			}

			conv, err := ConvertDWG(raw)
			if err != nil {
				t.Fatalf("转换失败：%v", err)
			}
			if conv.Degraded {
				t.Fatalf("走了降级位图路径，未做矢量还原：%s", conv.Note)
			}
			if !strings.Contains(conv.Note, "矢量还原") {
				t.Errorf("转换说明异常：%s", conv.Note)
			}

			// SVG：必须是合法矢量文档，且含真实图元
			svg := string(conv.SVG)
			for _, want := range []string{"<svg", "viewBox", "</svg>"} {
				if !strings.Contains(svg, want) {
					t.Errorf("SVG 缺少 %q（长度 %d）", want, len(svg))
				}
			}
			if strings.Contains(svg, "<image") {
				t.Error("矢量路径不应产出内嵌位图的 SVG")
			}
			if len(conv.SVG) < 200 {
				t.Errorf("SVG 过小（%d 字节），疑似空图", len(conv.SVG))
			}

			// PNG：必须可解码、尺寸合理、内容与图元数量一致
			img, err := png.Decode(bytes.NewReader(conv.PNG))
			if err != nil {
				t.Fatalf("PNG 解码失败：%v", err)
			}
			b := img.Bounds()
			// 图纸宽高比可能极端（例如只有一行文字），只拒绝"贴边到没有意义"的尺寸
			if b.Dx() < 16 || b.Dy() < 16 {
				t.Errorf("PNG 尺寸异常：%dx%d", b.Dx(), b.Dy())
			}

			// 独立解析中间 DXF，核对渲染结果是否与真实图元数量一致。
			// 有些图纸的 ENTITIES 段为空（只含未被 INSERT 引用的块定义），
			// 此时与 AutoCAD 一致地渲染为空白图纸，属于正确行为。
			dxf, err := DWGToDXF(raw)
			if err != nil {
				t.Fatalf("独立转换失败：%v", err)
			}
			d, err := ParseDXF(dxf)
			if err != nil {
				t.Fatalf("独立解析 DXF 失败：%v", err)
			}
			switch drawable := len(d.Polylines) + len(d.Texts); {
			case drawable == 0:
				t.Logf("%s 的 ENTITIES 段无可绘制图元，空白图纸符合预期", rel)
			case !hasNonWhite(img):
				t.Errorf("PNG 全白，但 DXF 中有 %d 个可绘制图元", drawable)
			}

			if outDir != "" {
				base := filepath.Join(outDir, strings.NewReplacer("/", "_", ".dwg", "").Replace(rel))
				if err := os.WriteFile(base+".svg", conv.SVG, 0o644); err != nil {
					t.Fatalf("落盘 SVG 失败：%v", err)
				}
				if err := os.WriteFile(base+".png", conv.PNG, 0o644); err != nil {
					t.Fatalf("落盘 PNG 失败：%v", err)
				}
				t.Logf("%s → SVG %d 字节 / PNG %dx%d %d 字节", rel, len(conv.SVG), b.Dx(), b.Dy(), len(conv.PNG))
			}
			passed++
		})
	}
	if passed == 0 {
		t.Fatal("没有任何夹具通过，请检查 DWG_FIXTURE_DIR 是否指向正确的测试图纸目录")
	}
}

// TestConvertDWGRejectsGarbage 确认损坏输入会被拒绝，而不是产出空图骗过用户。
func TestConvertDWGRejectsGarbage(t *testing.T) {
	if _, err := ConvertDWG([]byte("not a dwg at all")); err == nil {
		t.Fatal("非 DWG 数据应报错")
	}
	if _, err := ConvertDWG([]byte("AC10")); err == nil {
		t.Fatal("过短数据应报错")
	}
}

// TestConvertCadUnsupportedExt 确认未知扩展名被明确拒绝。
func TestConvertCadUnsupportedExt(t *testing.T) {
	if _, _, _, _, err := ConvertCad([]byte("x"), "step"); err == nil {
		t.Fatal("未知 CAD 扩展名应报错")
	}
}
