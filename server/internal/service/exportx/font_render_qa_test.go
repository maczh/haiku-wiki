package exportx

// QA 独立测试（第六轮 R6，测试轮次 2）——字体选择必须能被「真正产出 PDF 的解析器」接受。
//
// 背景（BUG-R6-02）：resolveFont 用 freetype 的 truetype.Parse + 字形探测（hasCJK）
// 来筛选字体，但真正消费字体字节的是 gopdf（AddTTFFontData）。两个解析器容忍度不同：
// macOS 上 /System/Library/Fonts/STHeiti Light.ttc 能通过 hasCJK，却让 gopdf 报
// 「No Unicode encoding found」，于是 LoadFont 成功、BuildPDF 全线失败 ——
// 表现为「导出 PDF/PNG 一律报错」，而同机上的 Arial Unicode.ttf / Songti.ttc 都可用。
//
// 本用例把这个不一致钉住：选中的字体必须能被渲染器加载，否则导出链路就是断的。

import (
	"testing"

	"github.com/signintech/gopdf"
)

// TestQAExportFontUsableByPDFRenderer 选中的字体必须能被 PDF 渲染器加载。
func TestQAExportFontUsableByPDFRenderer(t *testing.T) {
	raw, err := LoadFont()
	if err != nil {
		t.Skipf("本机未找到任何中文字体，跳过（非本用例关注点）: %v", err)
	}
	pdf := &gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: gopdf.Rect{W: 595, H: 842}})
	if err := pdf.AddTTFFontData("qa-font", raw); err != nil {
		t.Fatalf(
			"resolveFont 选中的字体 %q（%d 字节）无法被 PDF 渲染器加载: %v\n"+
				"根因：hasCJK 用 freetype 校验、gopdf 才是真正消费者，两者容忍度不同；\n"+
				"修复方向：候选字体与目录扫描都要再用 gopdf 复验一次，通不过就换下一个候选。",
			FontPath(), len(raw), err,
		)
	}
}
