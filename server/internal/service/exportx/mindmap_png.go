package exportx

import (
	"bytes"
	"fmt"
	"image/png"
	"strings"
)

// 思维导图布局常量（逻辑结构图：根在左，子节点向右展开）
const (
	mmFontSize    = 14.0
	mmPadX        = 14.0
	mmPadY        = 9.0
	mmGapX        = 46.0 // 层级间距
	mmGapY        = 12.0 // 同级间距
	mmMargin      = 40.0
	mmMaxNodeW    = 260.0
	mmMaxTextW    = 200.0
	mmMaxNodesPng = 600
)

type mmLayoutNode struct {
	node   *MindNode
	depth  int
	x, y   float64 // 左上角
	w, h   float64
	lines  []string
	parent *mmLayoutNode
}

type mmLayout struct {
	root   *mmLayoutNode
	width  float64
	height float64
	all    []*mmLayoutNode
}

// layoutMindmap 计算逻辑结构图布局（同级按纵向堆叠，子树高度决定父节点位置）。
func layoutMindmap(root *MindNode, font *canvas) (*mmLayout, error) {
	if countNodes(root) > mmMaxNodesPng {
		return nil, fmt.Errorf("思维导图节点过多（超过 %d 个），暂不支持导出 PNG", mmMaxNodesPng)
	}
	lay := &mmLayout{}
	// 先度量并计算子树高度
	sizeOf := func(n *MindNode) (w, h float64, lines []string) {
		f := font.face(mmFontSize)
		lines = wrapTextForWidth(f, n.Text, mmMaxTextW)
		maxW := 0.0
		for _, l := range lines {
			if lw := measureText(f, l); lw > maxW {
				maxW = lw
			}
		}
		return maxW + 2*mmPadX, float64(len(lines))*lineHeight(mmFontSize) + 2*mmPadY, lines
	}
	var build func(n *MindNode, depth int, parent *mmLayoutNode) *mmLayoutNode
	build = func(n *MindNode, depth int, parent *mmLayoutNode) *mmLayoutNode {
		w, h, lines := sizeOf(n)
		ln := &mmLayoutNode{node: n, depth: depth, w: w, h: h, lines: lines, parent: parent}
		lay.all = append(lay.all, ln)
		return ln
	}

	subtreeCache := map[*MindNode]float64{}
	var subtreeHeight func(n *MindNode) float64
	subtreeHeight = func(n *MindNode) float64 {
		if v, ok := subtreeCache[n]; ok {
			return v
		}
		_, h, _ := sizeOf(n)
		total := h
		if len(n.Children) > 0 {
			sum := 0.0
			for _, c := range n.Children {
				sum += subtreeHeight(c) + mmGapY
			}
			sum -= mmGapY
			if sum > h {
				total = sum
			}
		}
		subtreeCache[n] = total
		return total
	}

	var place func(n *MindNode, depth int, x, yTop float64, parent *mmLayoutNode)
	place = func(n *MindNode, depth int, x, yTop float64, parent *mmLayoutNode) {
		sh := subtreeHeight(n)
		w, h, _ := sizeOf(n)
		ln := build(n, depth, parent)
		ln.w, ln.h = w, h
		ln.x = x
		ln.y = yTop + (sh-h)/2
		if len(n.Children) == 0 {
			return
		}
		childX := x + w + mmGapX
		cursor := yTop
		for _, c := range n.Children {
			ch := subtreeHeight(c)
			place(c, depth+1, childX, cursor, ln)
			cursor += ch + mmGapY
		}
	}
	place(root, 0, mmMargin, mmMargin, nil)
	lay.root = lay.all[0]

	maxRight, maxBottom := 0.0, 0.0
	for _, n := range lay.all {
		if r := n.x + n.w; r > maxRight {
			maxRight = r
		}
		if b := n.y + n.h; b > maxBottom {
			maxBottom = b
		}
	}
	lay.width = maxRight + mmMargin
	lay.height = maxBottom + mmMargin
	return lay, nil
}

func lineHeight(fontSize float64) float64 { return fontSize * 1.45 }

// nodePalette 按层级返回节点填充色/文字色。
func nodePalette(depth int) (fill, text [3]uint8) {
	switch depth {
	case 0:
		return rgbRootFill, rgbRootText
	case 1:
		return rgbLevel1, rgbLevel1Tx
	case 2:
		return rgbLevel2, rgbLevel1Tx
	case 3:
		return rgbLevel3, rgbLevel1Tx
	default:
		return [3]uint8{247, 248, 250}, rgbText
	}
}

// BuildMindmapPNG 把思维导图内容渲染为 PNG（逻辑结构图，中文字体嵌入位图）。
func BuildMindmapPNG(content string) ([]byte, error) {
	root := ParseMindmap(content)
	// 先做一次无画布的布局度量：借用临时画布
	probe, err := newCanvas(10, 10)
	if err != nil {
		return nil, err
	}
	lay, err := layoutMindmap(root, probe)
	if err != nil {
		return nil, err
	}
	// 限制画布尺寸，避免超大内存占用
	scale := 2.0 // 2 倍图，导出更清晰
	maxDim := 8000.0
	if lay.width*scale > maxDim || lay.height*scale > maxDim {
		scale = minFloat(maxDim/lay.width, maxDim/lay.height)
		if scale < 1 {
			scale = 1
		}
	}
	w := int(lay.width * scale)
	h := int(lay.height * scale)
	if w < 320 {
		w = 320
	}
	if h < 200 {
		h = 200
	}

	c, err := newCanvas(w, h)
	if err != nil {
		return nil, err
	}
	c.dc.Scale(scale, scale)

	// 连线（先画线，节点覆盖其上）
	for _, n := range lay.all {
		if n.parent == nil {
			continue
		}
		p := n.parent
		x1 := p.x + p.w
		y1 := p.y + p.h/2
		x2 := n.x
		y2 := n.y + n.h/2
		cx1 := x1 + mmGapX*0.5
		cx2 := x2 - mmGapX*0.5
		if n.depth == 1 {
			c.drawBezier(x1, y1, cx1, y1, cx2, y2, x2, y2, rgbLine, 1.6)
		} else {
			c.drawBezier(x1, y1, cx1, y1, cx2, y2, x2, y2, [3]uint8{214, 222, 232}, 1.3)
		}
	}
	// 节点
	for _, n := range lay.all {
		fill, text := nodePalette(n.depth)
		stroke := [3]uint8{217, 224, 232}
		if n.depth == 0 {
			stroke = rgbRootFill
		}
		if n.depth == 1 {
			stroke = [3]uint8{184, 199, 228}
		}
		radius := 8.0
		if n.depth == 0 {
			radius = 10.0
		}
		c.fillRoundRect(n.x, n.y, n.w, n.h, radius, fill, stroke, 1.4)
		c.drawStringWrapped(n.lines, n.x, n.y, n.w, n.h, lineHeight(mmFontSize), mmFontSize, text)
	}

	buf := &bytes.Buffer{}
	if err := png.Encode(buf, c.dc.Image()); err != nil {
		return nil, fmt.Errorf("生成 PNG 失败：%v", err)
	}
	return buf.Bytes(), nil
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// mindmapPlainOutline 生成思维导图的大纲文本（备用：需要纯文本导出时使用）。
func mindmapPlainOutline(root *MindNode) string {
	var sb strings.Builder
	var walk func(n *MindNode, depth int)
	walk = func(n *MindNode, depth int) {
		sb.WriteString(strings.Repeat("  ", depth))
		sb.WriteString("- ")
		sb.WriteString(n.Text)
		sb.WriteString("\n")
		for _, c := range n.Children {
			walk(c, depth+1)
		}
	}
	walk(root, 0)
	return sb.String()
}
