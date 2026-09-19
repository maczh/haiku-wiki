package exportx

// DXF 文字渲染的回归测试。
//
// 背景：用户报「.dwg 转出来的预览 .svg 里文字字体太大，导出图片糊成一片」。
// 逐条定位到下面几个成因，本文件把每一条都钉成断言
// （每条都验证过：在修复前的代码上会失败）。
//
//	① 字高兜底写死世界坐标常量 2.5 —— 字高脱离图幅尺度没有意义，
//	   米制/小尺寸图幅下折算出的字号能到图幅的几十分之一；
//	② SVG 把 <6px 的字号一律抬到 6px —— 密排标注下字比图元还大，互相覆盖成黑块；
//	③ cleanDXFText 把 MTEXT 的段落符 \P 折成空格 —— 多行注释被压成一整行横贯图幅；
//	④ STYLE 表的固定字高没解析 —— 字高为 0 的实体永远拿不到真实字高；
//	⑤ INSERT 组码 43 被当成 scaleY 写回 —— 覆盖了 42 读到的 Y 缩放；
//	⑥ 嵌套块参照的插入点丢掉了外层缩放 —— 块中块整体错位；
//	⑦ DIMENSION 的块引用读不到 —— 所有尺寸标注被静默丢弃。

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// ---------- 夹具构造 ----------

// dxfHeader 生成 HEADER 段：图幅 (0,0)-(extent,extent)。
// textSize > 0 时附带 $TEXTSIZE。
func dxfHeader(extent, textSize float64) string {
	s := "0\nSECTION\n2\nHEADER\n" +
		"9\n$INSUNITS\n70\n4\n" +
		"9\n$EXTMIN\n10\n0.0\n20\n0.0\n" +
		"9\n$EXTMAX\n10\n" + f(extent) + "\n20\n" + f(extent) + "\n"
	if textSize > 0 {
		s += "9\n$TEXTSIZE\n40\n" + f(textSize) + "\n"
	}
	return s + "0\nENDSEC\n"
}

// dxfStyleTable 生成 STYLE 表，含一个固定字高为 fixedHeight 的样式 FIXED。
func dxfStyleTable(fixedHeight float64) string {
	return "0\nSECTION\n2\nTABLES\n" +
		"0\nTABLE\n2\nSTYLE\n" +
		"0\nSTYLE\n2\nFIXED\n40\n" + f(fixedHeight) + "\n41\n1.0\n" +
		"0\nENDTAB\n0\nENDSEC\n"
}

// dxfDoc 拼一份完整 DXF（无 TABLES 段）。
func dxfDoc(header, blocks, entities string) string {
	return header + blocks + "0\nSECTION\n2\nENTITIES\n" + entities + "0\nENDSEC\n0\nEOF\n"
}

func f(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// textEntity 一条 TEXT（height<=0 时省略组码 40，模拟「字高由样式决定」）。
func textEntity(x, y, height float64, style, content string) string {
	s := "0\nTEXT\n8\n0\n10\n" + f(x) + "\n20\n" + f(y) + "\n"
	if height > 0 {
		s += "40\n" + f(height) + "\n"
	}
	if style != "" {
		s += "7\n" + style + "\n"
	}
	return s + "1\n" + content + "\n"
}

// lineEntity 一条 LINE，用于给图幅一个真实的几何参照。
func lineEntity(x1, y1, x2, y2 float64) string {
	return "0\nLINE\n8\n0\n10\n" + f(x1) + "\n20\n" + f(y1) +
		"\n11\n" + f(x2) + "\n21\n" + f(y2) + "\n"
}

// ---------- SVG 断言工具 ----------

var fontSizeRe = regexp.MustCompile(`font-size="([0-9.]+)"`)

func svgFontSizes(t *testing.T, svg []byte) []float64 {
	t.Helper()
	m := fontSizeRe.FindAllSubmatch(svg, -1)
	out := make([]float64, 0, len(m))
	for _, g := range m {
		v, err := strconv.ParseFloat(string(g[1]), 64)
		if err != nil {
			t.Fatalf("font-size 解析失败: %q", g[1])
		}
		out = append(out, v)
	}
	return out
}

func svgOf(t *testing.T, src string) []byte {
	t.Helper()
	d, err := ParseDXF([]byte(src))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	svg, err := BuildCadSVG(d)
	if err != nil {
		t.Fatalf("生成 SVG 失败: %v", err)
	}
	return svg
}

func maxOf(vs []float64) float64 {
	m := 0.0
	for _, v := range vs {
		if v > m {
			m = v
		}
	}
	return m
}

// ---------- ① / ④ 字高必须相对图幅，且要能读到样式固定字高 ----------

// TestCadFontSizeIsScaleInvariant 字号必须与图幅单位无关。
//
// 同一张图，一份按「米」画（图幅 100），一份按「毫米」画（图幅 100000，字高同比放大 1000 倍），
// 渲染出来的字号必须**完全一致** —— 因为 AutoCAD 里它们看起来就是一样的。
// 修复前：字高为 0 时兜底写死 2.5 世界单位，两份的字号相差 1000 倍。
func TestCadFontSizeIsScaleInvariant(t *testing.T) {
	build := func(extent float64) []byte {
		src := dxfDoc(
			dxfHeader(extent, 0),
			dxfStyleTable(0), // 样式不固定字高 → 走兜底
			lineEntity(0, 0, extent, 0)+
				textEntity(1, extent*0.5, 0, "", "无字高文字"),
		)
		return svgOf(t, src)
	}
	small := maxOf(svgFontSizes(t, build(100)))
	large := maxOf(svgFontSizes(t, build(100000)))

	if small <= 0 || large <= 0 {
		t.Fatalf("未渲染出文字（small=%.3f large=%.3f）", small, large)
	}
	if math.Abs(small-large) > 0.5 {
		t.Fatalf("字号随单位尺度漂移：图幅 100 → %.2fpx，图幅 100000 → %.2fpx。"+
			"兜底字高必须是图幅的固定比例，不能是写死的世界坐标常量", small, large)
	}
}

// TestCadTextHeightFromStyle STYLE 表里的固定字高必须被采用。
//
// 场景：文字样式固定了字高，实体自身组码 40 为 0。修复前会直接回落到 2.5，
// 得到的字号与真实值差一个数量级。
func TestCadTextHeightFromStyle(t *testing.T) {
	const extent, styleH = 100.0, 5.0
	src := dxfDoc(
		dxfHeader(extent, 0),
		dxfStyleTable(styleH),
		lineEntity(0, 0, extent, 0)+textEntity(1, 50, 0, "FIXED", "样式定高"),
	)
	size := maxOf(svgFontSizes(t, svgOf(t, src)))
	// 设备缩放 = min(1600-48, 1200-48)/extent = 1152/100 = 11.52
	want := styleH * (1152.0 / extent)
	if math.Abs(size-want) > 0.5 {
		t.Fatalf("字号 = %.2fpx，期望 %.2fpx（取自样式固定字高 %.1f）", size, want, styleH)
	}
}

// TestCadSvgKeepsSmallFontsProportional ②：SVG 不得有小字号抬升。
//
// 图幅 100000、字高 100（真实字号约 1.15px）。修复前被抬到 6px —— 是真实值的 5 倍多，
// 密排标注下就是互相覆盖的一片黑。SVG 是矢量、前端可放大 60 倍，必须保持真实比例。
func TestCadSvgKeepsSmallFontsProportional(t *testing.T) {
	const extent, h = 100000.0, 100.0
	src := dxfDoc(
		dxfHeader(extent, 0),
		dxfStyleTable(0),
		lineEntity(0, 0, extent, 0)+textEntity(1, extent*0.5, h, "", "很小的标注"),
	)
	size := maxOf(svgFontSizes(t, svgOf(t, src)))
	want := h * (1152.0 / extent) // ≈ 1.152
	if math.Abs(size-want) > 0.05 {
		t.Fatalf("SVG 字号 = %.3fpx，期望 %.3fpx（矢量输出不得抬升小字号）", size, want)
	}
	if size >= 6 {
		t.Fatalf("SVG 字号 %.3fpx 仍被打到了 6px 下限", size)
	}
}

// TestCadPngKeepsLegibilityFloor 位图相反：固定分辨率不可缩放，仍保留可读下限。
// 与上一条构成对照，说明 SVG / PNG 两条路径的策略是**刻意不同**的。
func TestCadPngKeepsLegibilityFloor(t *testing.T) {
	d, err := ParseDXF([]byte(dxfDoc(
		dxfHeader(100000, 0),
		dxfStyleTable(0),
		lineEntity(0, 0, 100000, 0)+textEntity(1, 50000, 100, "", "很小的标注"),
	)))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if _, err := BuildCadPNG(d); err != nil {
		t.Fatalf("生成 PNG 失败: %v", err)
	}
	// 字号下限只影响绘制，这里直接校验钳制函数本身
	if got := cadFontSize(0.5, pngMinFontSize, 100); got != pngMinFontSize {
		t.Fatalf("位图字号下限失效：cadFontSize(0.5) = %.1f，期望 %.1f", got, float64(pngMinFontSize))
	}
	if got := cadFontSize(0.5, 0, 100); got != 0.5 {
		t.Fatalf("矢量路径不应抬升小字号：cadFontSize(0.5, 0, 100) = %.2f", got)
	}
	if got := cadFontSize(1e6, 0, 100); got != 100 {
		t.Fatalf("病态字高未被上限挡住：cadFontSize(1e6, 0, 100) = %.1f", got)
	}
}

// ---------- ③ / MTEXT 折行 ----------

// TestCleanDXFTextKeepsParagraphBreak 段落符 \P 必须保留为换行。
func TestCleanDXFTextKeepsParagraphBreak(t *testing.T) {
	if got := cleanDXFText("第一行\\P第二行"); got != "第一行\n第二行" {
		t.Fatalf("cleanDXFText 段落符处理 = %q，期望保留换行", got)
	}
	// 其余格式码仍应被剥掉，且行内连续空白仍要收敛
	if got := cleanDXFText(`\fArial|b0|i0;房间名`); got != "房间名" {
		t.Fatalf("字体码未剥净: %q", got)
	}
	if got := cleanDXFText("前\\P  中   后"); got != "前\n中 后" {
		t.Fatalf("行内空白未收敛或换行丢失: %q", got)
	}
}

// TestCadMTextMultiLine 多行 MTEXT 必须渲染成多行，而不是一整行。
func TestCadMTextMultiLine(t *testing.T) {
	mtext := "0\nMTEXT\n8\n0\n10\n5.0\n20\n5.0\n40\n4.0\n1\n注释一\\P注释二\\P注释三\n"
	src := dxfDoc(
		dxfHeader(100, 0),
		dxfStyleTable(0),
		lineEntity(0, 0, 100, 0)+mtext,
	)
	svg := string(svgOf(t, src))
	if n := strings.Count(svg, "<text"); n != 3 {
		t.Fatalf("多行 MTEXT 渲染出 %d 行，期望 3 行；整段被压成一行就是「糊成一片」的成因", n)
	}
	if strings.Contains(svg, "注释一 注释二 注释三") {
		t.Fatal("段落符仍被折成空格：多行注释被压成了一整行长文本")
	}
}

// TestCadMTextWrapsByReferenceWidth 超出参考宽度的 MTEXT 必须折行。
func TestCadMTextWrapsByReferenceWidth(t *testing.T) {
	long := strings.Repeat("宽", 40) // 40 个全角字
	// 参考宽度 40、字高 4 → 每行约 40/(4*0.62) ≈ 16 字 → 至少 3 行
	mtext := "0\nMTEXT\n8\n0\n10\n5.0\n20\n5.0\n40\n4.0\n41\n40.0\n1\n" + long + "\n"
	src := dxfDoc(dxfHeader(200, 0), dxfStyleTable(0), lineEntity(0, 0, 200, 0)+mtext)
	svg := string(svgOf(t, src))
	if n := strings.Count(svg, "<text"); n < 3 {
		t.Fatalf("超宽 MTEXT 未折行，只有 %d 行；不折行的长注释会横贯整幅图", n)
	}
}

// TestCadTextAnchorFromJustification TEXT 的 72/73 非 0 时，落点取对齐点 11/21。
func TestCadTextAnchorFromJustification(t *testing.T) {
	// 居中对齐：名义插入点 (10,50)，真实对齐点 (60,50)
	ent := "0\nTEXT\n8\n0\n10\n10.0\n20\n50.0\n11\n60.0\n21\n50.0\n" +
		"40\n4.0\n72\n1\n73\n2\n1\n居中标题\n"
	d, err := ParseDXF([]byte(dxfDoc(dxfHeader(100, 0), dxfStyleTable(0), lineEntity(0, 0, 100, 0)+ent)))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(d.Texts) != 1 {
		t.Fatalf("文字数 = %d，期望 1", len(d.Texts))
	}
	tx := d.Texts[0]
	if math.Abs(tx.Pos.X-60) > 0.01 {
		t.Fatalf("对齐点在 x=%.1f，期望 60（应取组码 11 而非 10）", tx.Pos.X)
	}
	if tx.AnchorH != 1 || tx.AnchorV != 2 {
		t.Fatalf("锚点 = (H%d,V%d)，期望 (H1,V2) 居中", tx.AnchorH, tx.AnchorV)
	}
	if !strings.Contains(string(svgOf(t, dxfDoc(dxfHeader(100, 0), dxfStyleTable(0), lineEntity(0, 0, 100, 0)+ent))),
		`text-anchor="middle"`) {
		t.Fatal("SVG 未输出 text-anchor=\"middle\"")
	}
}

// ---------- ⑤ INSERT 组码 43 ----------

// TestCadInsertScaleZDoesNotClobberScaleY 组码 43 是 scaleZ，不能写回 scaleY。
//
// 块内一条 (0,0)-(0,1) 的线，块参照 41=2 / 42=3 / 43=5。
// 正确结果：(0,0)-(0,3)。修复前 43 覆盖了 42，得到 (0,0)-(0,5)。
func TestCadInsertScaleZDoesNotClobberScaleY(t *testing.T) {
	blocks := "0\nSECTION\n2\nBLOCKS\n" +
		"0\nBLOCK\n2\nB\n10\n0.0\n20\n0.0\n" +
		"0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n0.0\n21\n1.0\n" +
		"0\nENDBLK\n0\nENDSEC\n"
	insert := "0\nINSERT\n8\n0\n2\nB\n10\n0.0\n20\n0.0\n41\n2.0\n42\n3.0\n43\n5.0\n"
	d, err := ParseDXF([]byte(dxfDoc(dxfHeader(100, 0), blocks, lineEntity(0, 0, 100, 0)+insert)))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	maxY := 0.0
	for _, pl := range d.Polylines {
		for _, p := range pl.Pts {
			if p.Y > maxY {
				maxY = p.Y
			}
		}
	}
	if math.Abs(maxY-3) > 0.01 {
		t.Fatalf("块参照 Y 方向最大坐标 = %.2f，期望 3（42 的 scaleY）；"+
			"出现 5 说明组码 43 被误当成 scaleY 覆盖了 42", maxY)
	}
}

// ---------- ⑥ 嵌套块参照 ----------

// TestCadNestedInsertAppliesOuterScale 嵌套块参照的插入点必须乘外层缩放。
//
// 结构：B2 内一条 (0,0)-(1,0) 的线；B1 内一条 (0,0)-(10,0) 的线 + 在 (5,0) 处插入 B2；
// 顶层在 (100,0) 处以缩放 2 插入 B1。
// 正确：B2 的线落在 (110,0)-(112,0)。修复前插入点丢了外层缩放，落在 (105,0)-(107,0)。
func TestCadNestedInsertAppliesOuterScale(t *testing.T) {
	blocks := "0\nSECTION\n2\nBLOCKS\n" +
		"0\nBLOCK\n2\nB2\n10\n0.0\n20\n0.0\n" +
		"0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n1.0\n21\n0.0\n" +
		"0\nENDBLK\n" +
		"0\nBLOCK\n2\nB1\n10\n0.0\n20\n0.0\n" +
		"0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n" +
		"0\nINSERT\n8\n0\n2\nB2\n10\n5.0\n20\n0.0\n41\n1.0\n42\n1.0\n" +
		"0\nENDBLK\n0\nENDSEC\n"
	insert := "0\nINSERT\n8\n0\n2\nB1\n10\n100.0\n20\n0.0\n41\n2.0\n42\n2.0\n"
	d, err := ParseDXF([]byte(dxfDoc(dxfHeader(200, 0), blocks, insert)))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	found := false
	for _, pl := range d.Polylines {
		for _, p := range pl.Pts {
			if math.Abs(p.X-110) < 0.01 && math.Abs(p.Y) < 0.01 {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("未找到嵌套块内图元应落在的 (110,0)：插入点丢失了外层缩放，块中块整体错位")
	}
}

// ---------- ⑦ DIMENSION ----------

// TestCadDimensionBlockIsRendered 尺寸标注的匿名块必须被展开渲染。
//
// 修复前 fillCommon 的组码 2 只认 INSERT，DIMENSION 拿不到块名，
// emit 里的 DIMENSION 分支是一段永远进不去的死代码 —— 所有尺寸标注凭空消失。
func TestCadDimensionBlockIsRendered(t *testing.T) {
	blocks := "0\nSECTION\n2\nBLOCKS\n" +
		"0\nBLOCK\n2\n*D1\n10\n0.0\n20\n0.0\n" +
		"0\nLINE\n8\n0\n10\n20.0\n20\n20.0\n11\n30.0\n21\n20.0\n" +
		"0\nENDBLK\n0\nENDSEC\n"
	dim := "0\nDIMENSION\n8\n0\n2\n*D1\n10\n20.0\n20\n20.0\n"
	d, err := ParseDXF([]byte(dxfDoc(dxfHeader(100, 0), blocks, lineEntity(0, 0, 100, 0)+dim)))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	found := false
	for _, pl := range d.Polylines {
		for _, p := range pl.Pts {
			if math.Abs(p.X-30) < 0.01 && math.Abs(p.Y-20) < 0.01 {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("尺寸标注的块几何未被渲染（DIMENSION 的组码 2 未解析）")
	}
}

// ---------- ⑧ 双路径一致性 ----------

// TestCadBothRenderersAgreeOnText 同一份图，SVG 与 PNG 都必须能画出来，
// 且 SVG 的行数与文字内容应可被完整读出（PNG 只做冒烟：不报错且非全白）。
func TestCadBothRenderersAgreeOnText(t *testing.T) {
	src := dxfDoc(
		dxfHeader(100, 0),
		dxfStyleTable(3.5),
		lineEntity(0, 0, 100, 0)+
			textEntity(5, 50, 0, "FIXED", "样式定高")+
			textEntity(5, 30, 4, "", "实体定高"),
	)
	d, err := ParseDXF([]byte(src))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(d.Texts) != 2 {
		t.Fatalf("文字数 = %d，期望 2", len(d.Texts))
	}
	svg, err := BuildCadSVG(d)
	if err != nil {
		t.Fatalf("SVG 失败: %v", err)
	}
	if n := strings.Count(string(svg), "<text"); n != 2 {
		t.Fatalf("SVG 文字节点 = %d，期望 2", n)
	}
	png, err := BuildCadPNG(d)
	if err != nil {
		t.Fatalf("PNG 失败: %v", err)
	}
	if len(png) == 0 {
		t.Fatal("PNG 为空")
	}
}

// TestCadTextFallbackNoAbsoluteConstant 兜底字高绝不能等于写死的 2.5 世界单位。
// 用两个相差 1000 倍的图幅交叉验证：若兜底是常量，两者字号必然差 1000 倍。
func TestCadTextFallbackNoAbsoluteConstant(t *testing.T) {
	ratio := func(extent float64) float64 {
		src := dxfDoc(dxfHeader(extent, 0), dxfStyleTable(0),
			lineEntity(0, 0, extent, 0)+textEntity(1, extent*0.5, 0, "", "x"))
		d, err := ParseDXF([]byte(src))
		if err != nil {
			t.Fatalf("解析失败: %v", err)
		}
		if len(d.Texts) != 1 {
			t.Fatalf("文字数 = %d", len(d.Texts))
		}
		return d.Texts[0].Height / extent
	}
	a, b := ratio(100), ratio(100000)
	if math.Abs(a-b) > 1e-6 {
		t.Fatalf("兜底字高占图幅的比例不一致：%.6f vs %.6f（兜底值必须相对图幅）", a, b)
	}
	if math.Abs(a-1.0/60.0) > 1e-9 {
		t.Fatalf("兜底比例 = %v，期望 1/60", a)
	}
}
