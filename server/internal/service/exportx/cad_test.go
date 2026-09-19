package exportx

import (
	"bytes"
	"image"
	"image/png"
	"strings"
	"testing"
)

// dxfFixture 一份覆盖常用实体的最小 DXF：
// LINE、LWPOLYLINE（含 90 度凸度圆弧 + 闭合 flag）、CIRCLE、ARC、
// TEXT、以及 BLOCK + INSERT（含缩放/旋转），用于验证解析与渲染。
const dxfFixture = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
9
$EXTMIN
10
0.0
20
0.0
9
$EXTMAX
10
100.0
20
60.0
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
0
62
7
0
LAYER
2
WALLS
62
1
0
ENDTAB
0
ENDSEC
0
SECTION
2
BLOCKS
0
BLOCK
2
DOOR
10
0.0
20
0.0
0
LINE
8
0
10
0.0
20
0.0
11
5.0
21
0.0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
WALLS
10
0.0
20
0.0
11
100.0
21
0.0
0
LWPOLYLINE
8
0
90
4
70
1
10
10.0
20
10.0
10
40.0
20
10.0
42
1.0
10
40.0
20
30.0
10
10.0
20
30.0
0
CIRCLE
8
0
10
70.0
20
20.0
40
8.0
0
ARC
8
0
10
70.0
20
45.0
40
10.0
50
0.0
51
90.0
0
ELLIPSE
8
0
10
20.0
20
45.0
11
12.0
21
0.0
40
0.5
0
TEXT
8
0
10
5.0
20
55.0
40
4.0
1
机房 A 区
0
TEXT
8
0
10
50.0
20
55.0
40
4.0
50
30.0
1
ROTATED
0
INSERT
8
0
2
DOOR
10
90.0
20
50.0
41
2.0
42
2.0
50
90.0
0
ENDSEC
0
EOF
`

func TestParseDXFBasic(t *testing.T) {
	d, err := ParseDXF([]byte(dxfFixture))
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if len(d.Polylines) == 0 {
		t.Fatal("未解析出任何折线")
	}
	if len(d.Texts) != 2 {
		t.Fatalf("文字数量 = %d，期望 2", len(d.Texts))
	}
	if d.Units != 4 {
		t.Errorf("$INSUNITS = %d，期望 4（毫米）", d.Units)
	}
	// BLOCK 里的 LINE 经 INSERT 缩放 2 倍、旋转 90 度后应落在 (90,50) 附近
	found := false
	for _, pl := range d.Polylines {
		for _, p := range pl.Pts {
			if abs(p.X-90) < 0.01 && abs(p.Y-50) < 0.01 {
				found = true
			}
		}
	}
	if !found {
		t.Error("未找到 INSERT 展开后的门块起点 (90,50)")
	}
	// 圆按离散化后应生成闭合折线，点数 > 8
	circlePts := 0
	for _, pl := range d.Polylines {
		if pl.Closed && len(pl.Pts) > 8 {
			circlePts = len(pl.Pts)
		}
	}
	if circlePts == 0 {
		t.Error("圆的离散化折线缺失")
	}
	// 凸度圆弧：LWPOLYLINE 第二段带 90 度弧，展开后总点数应明显多于 5
	polyPts := 0
	for _, pl := range d.Polylines {
		if pl.Closed && len(pl.Pts) > 8 {
			polyPts = len(pl.Pts)
		}
	}
	if polyPts < 10 {
		t.Errorf("含凸度圆弧的多段线点数 = %d，期望 >= 10", polyPts)
	}
	// 图层颜色应生效（WALLS → ACI 1 红）
	hasRed := false
	for _, pl := range d.Polylines {
		if strings.EqualFold(pl.Color, "#ff0000") {
			hasRed = true
		}
	}
	if !hasRed {
		t.Error("WALLS 图层的 ACI 1 红色未生效")
	}
}

func TestBuildCadSVG(t *testing.T) {
	d, err := ParseDXF([]byte(dxfFixture))
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	svg, err := BuildCadSVG(d)
	if err != nil {
		t.Fatalf("生成 SVG 失败：%v", err)
	}
	s := string(svg)
	for _, want := range []string{"<svg", "viewBox", "<polyline", "<text", "机房 A 区", "</svg>"} {
		if !strings.Contains(s, want) {
			t.Errorf("SVG 缺少 %q", want)
		}
	}
	// 坐标必须已翻转到设备空间（Y 向下）：不应出现负坐标
	if strings.Contains(s, `points="-`) {
		t.Error("SVG 出现负坐标，Y 轴翻转或留白计算有误")
	}
}

func TestBuildCadPNG(t *testing.T) {
	d, err := ParseDXF([]byte(dxfFixture))
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	data, err := BuildCadPNG(d)
	if err != nil {
		t.Fatalf("生成 PNG 失败：%v", err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("PNG 解码失败：%v", err)
	}
	b := img.Bounds()
	if b.Dx() < 100 || b.Dy() < 100 {
		t.Fatalf("PNG 尺寸异常：%dx%d", b.Dx(), b.Dy())
	}
	if !hasNonWhite(img) {
		t.Error("PNG 全白，图元未绘制")
	}
}

func TestParseDXFRejectsBinary(t *testing.T) {
	_, err := ParseDXF([]byte("AutoCAD Binary DXF\r\n\x1a\x00extra"))
	if err == nil {
		t.Fatal("二进制 DXF 应报错而不是产出空图")
	}
	if !strings.Contains(err.Error(), "二进制") {
		t.Errorf("错误信息应说明二进制不支持，实际：%v", err)
	}
}

func TestParseDXFEmpty(t *testing.T) {
	_, err := ParseDXF([]byte("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"))
	if err == nil {
		t.Fatal("空图应报错")
	}
}

func TestCleanDXFText(t *testing.T) {
	cases := map[string]string{
		`\fArial|b0|i0;房间名`: "房间名",
		// \P 是段落分隔，必须保留为换行（折成空格会把多行注释压成一整行长文本，
		// 见 cad_text_qa_test.go 的 TestCadMTextMultiLine）
		"第一行\\P第二行":     "第一行\n第二行",
		"{颜色}\\C1;红色文字": "颜色红色文字",
		"普通文本":          "普通文本",
	}
	for in, want := range cases {
		if got := cleanDXFText(in); got != want {
			t.Errorf("cleanDXFText(%q) = %q，期望 %q", in, got, want)
		}
	}
}

func TestExpandBulgeSemicircle(t *testing.T) {
	// 从 (0,0) 到 (10,0) 的半圆凸度 1.0（180 度），采样点应显著偏离弦
	pts := expandBulges([]cadPt{{X: 0, Y: 0}, {X: 10, Y: 0}}, []float64{1.0, 0}, false)
	if len(pts) < 6 {
		t.Fatalf("半圆展开点数 = %d，期望 >= 6", len(pts))
	}
	maxDev := 0.0
	for _, p := range pts {
		if d := abs(p.Y); d > maxDev {
			maxDev = d
		}
	}
	if maxDev < 3 {
		t.Errorf("半圆弧偏离弦的最大距离 = %.2f，期望接近半径 5", maxDev)
	}
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

func hasNonWhite(img image.Image) bool {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if r < 0xf000 || g < 0xf000 || bl < 0xf000 {
				return true
			}
		}
	}
	return false
}
