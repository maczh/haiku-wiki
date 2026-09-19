// cadprobe 把「按真实尺度构造的」DXF 渲染成 SVG/PNG 落盘，供人工目视比对
// CAD 预览的观感（字号是否与 AutoCAD 一致、多行注释是否折行、密集标注是否重叠）。
//
// 为什么需要它：DXF→SVG 的字号问题几乎全部与**尺度**有关（字高是世界单位，
// 脱离图幅就没有意义）。单元测试能给数值断言，但「看起来对不对」必须落成图看。
// 本工具内置两套典型夹具，覆盖历史上出过问题的两类文件：
//
//	site   —— 场地总平面（图幅 400m×240m，标注仅 250mm）：标注相对图幅极小，
//	          历史实现会把它们抬到 6px 下限，比真实值大 6 倍；
//	metric —— 米制建筑平面（图幅 40m×30m，字高由 STYLE 固定为 0.5m）：
//	          历史实现拿写死的 2.5 世界单位兜底，相当于 2.5m 高的字。
//
// 用法：
//
//	go run ./cmd/cadprobe <输出目录>
//
// 输出 <目录>/site.{svg,png} 与 <目录>/metric.{svg,png}，
// 并在 stdout 打印图幅、文字/折线条数、font-size 区间与前几条文字的锚点。
// 对应的自动化断言在 internal/service/exportx/cad_text_qa_test.go。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"haiku-wiki/server/internal/service/exportx"
)

func f(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// sitePlan 场地总平面图：400m × 240m（mm 单位），36 个区域标注（字高 250mm），
// 一段用 \P 分段的说明文字，以及一个标题块。
func sitePlan() string {
	const W, H = 400000.0, 240000.0
	s := "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n" +
		"9\n$EXTMIN\n10\n0.0\n20\n0.0\n" +
		"9\n$EXTMAX\n10\n" + f(W) + "\n20\n" + f(H) + "\n" +
		"9\n$TEXTSIZE\n40\n250.0\n" +
		"0\nENDSEC\n"
	// STYLE 表：一个固定字高的样式（真实文件里很常见）
	s += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nSTYLE\n" +
		"0\nSTYLE\n2\nHZ\n40\n250.0\n41\n1.0\n" +
		"0\nENDTAB\n0\nENDSEC\n"
	s += "0\nSECTION\n2\nENTITIES\n"
	s += "0\nLINE\n8\n0\n10\n0\n20\n0\n11\n" + f(W) + "\n21\n0\n"
	s += "0\nLINE\n8\n0\n10\n" + f(W) + "\n20\n0\n11\n" + f(W) + "\n21\n" + f(H) + "\n"
	s += "0\nLINE\n8\n0\n10\n" + f(W) + "\n20\n" + f(H) + "\n11\n0\n21\n" + f(H) + "\n"
	s += "0\nLINE\n8\n0\n10\n0\n20\n" + f(H) + "\n11\n0\n21\n0\n"
	for r := 0; r < 6; r++ {
		for c := 0; c < 6; c++ {
			x := (float64(c) + 0.5) * (W / 6)
			y := (float64(r) + 0.5) * (H / 6)
			s += "0\nTEXT\n8\n0\n10\n" + f(x) + "\n20\n" + f(y) +
				"\n40\n250.0\n1\n区域 " + strconv.Itoa(r*6+c+1) + "\n"
		}
	}
	s += "0\nMTEXT\n8\n0\n10\n10000.0\n20\n" + f(H-12000) + "\n40\n600.0\n41\n90000.0\n" +
		"71\n1\n1\n" +
		"说明：\\P1. 本图为场地总平面示意，尺寸单位为毫米。\\P" +
		"2. 各区域标注为功能分区编号。\\P" +
		"3. 图中红线为用地边界，需现场复核。\\P" +
		"4. 未尽事宜按现行国家规范执行。\n"
	s += "0\nTEXT\n8\n0\n10\n" + f(W-120000) + "\n20\n8000\n40\n2400.0\n1\n场地总平面图\n"
	s += "0\nENDSEC\n0\nEOF\n"
	return s
}

// metricPlan 米制建筑平面：40m × 30m，字高由 STYLE 固定为 0.5m（实体不写组码 40）。
func metricPlan() string {
	const W, H = 40.0, 30.0
	s := "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n" +
		"9\n$EXTMIN\n10\n0.0\n20\n0.0\n" +
		"9\n$EXTMAX\n10\n" + f(W) + "\n20\n" + f(H) + "\n" +
		"0\nENDSEC\n"
	s += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nSTYLE\n" +
		"0\nSTYLE\n2\nHZ\n40\n0.5\n41\n1.0\n" +
		"0\nENDTAB\n0\nENDSEC\n"
	s += "0\nSECTION\n2\nENTITIES\n"
	s += "0\nLINE\n8\n0\n10\n0\n20\n0\n11\n" + f(W) + "\n21\n0\n"
	s += "0\nLINE\n8\n0\n10\n0\n20\n0\n11\n0\n21\n" + f(H) + "\n"
	s += "0\nLINE\n8\n0\n10\n" + f(W) + "\n20\n0\n11\n" + f(W) + "\n21\n" + f(H) + "\n"
	s += "0\nLINE\n8\n0\n10\n" + f(W) + "\n20\n" + f(H) + "\n11\n0\n21\n" + f(H) + "\n"
	for i := 0; i < 6; i++ {
		s += "0\nTEXT\n8\n0\n10\n2.0\n20\n" + f(4+float64(i)*4) +
			"\n7\nHZ\n1\n房间 " + strconv.Itoa(i+1) + "\n"
	}
	s += "0\nENDSEC\n0\nEOF\n"
	return s
}

var fontRe = regexp.MustCompile(`font-size="([0-9.]+)"`)

func report(name, src, outDir string) {
	d, err := exportx.ParseDXF([]byte(src))
	if err != nil {
		fmt.Printf("%s: 解析失败 %v\n", name, err)
		return
	}
	svg, err := exportx.BuildCadSVG(d)
	if err != nil {
		fmt.Printf("%s: SVG 失败 %v\n", name, err)
		return
	}
	if err := os.WriteFile(filepath.Join(outDir, name+".svg"), svg, 0o644); err != nil {
		fmt.Printf("%s: 落盘 SVG 失败 %v\n", name, err)
		return
	}
	minSize, maxSize := 1e18, 0.0
	for _, m := range fontRe.FindAllStringSubmatch(string(svg), -1) {
		v, _ := strconv.ParseFloat(m[1], 64)
		if v < minSize {
			minSize = v
		}
		if v > maxSize {
			maxSize = v
		}
	}
	if minSize > maxSize {
		minSize = 0
	}
	preview := make([]string, 0, 3)
	for i, t := range d.Texts {
		if i >= 3 {
			break
		}
		preview = append(preview, fmt.Sprintf("%q(h=%.1f,anchor=%d/%d)", t.Content, t.Height, t.AnchorH, t.AnchorV))
	}
	fmt.Printf("%s: 图幅 %.0f×%.0f | 文字 %d 条 折线 %d 条 | font-size %.2f~%.2fpx | 前几条：%v\n",
		name, d.Width(), d.Height(), len(d.Texts), len(d.Polylines), minSize, maxSize, preview)
	if png, err := exportx.BuildCadPNG(d); err == nil {
		if err := os.WriteFile(filepath.Join(outDir, name+".png"), png, 0o644); err != nil {
			fmt.Printf("%s: 落盘 PNG 失败 %v\n", name, err)
		}
	} else {
		fmt.Printf("%s: PNG 失败 %v\n", name, err)
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "用法: go run ./cmd/cadprobe <输出目录>")
		os.Exit(2)
	}
	outDir := os.Args[1]
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "创建输出目录失败: %v\n", err)
		os.Exit(1)
	}
	report("site", sitePlan(), outDir)
	report("metric", metricPlan(), outDir)
}
