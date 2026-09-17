package exportx

import (
	"bytes"
	"fmt"
	"image/png"
	"math"
	"strings"
)

// 流程图布局常量（像素）
const (
	flowFont      = 13.5
	flowLabelFont = 11.5
	flowPadX      = 14.0
	flowPadY      = 9.0
	flowLayerGap  = 62.0
	flowNodeGap   = 26.0
	flowMargin    = 32.0
	flowMaxTextW  = 190.0
)

// FlowLayout 布局结果。
type FlowLayout struct {
	Graph      *MermaidGraph
	Width      float64
	Height     float64
	Horizontal bool // true = LR/RL（沿水平方向分层）
}

// LayoutFlowchart 计算流程图分层布局（最长路径分层 + 重心排序减少交叉）。
func LayoutFlowchart(g *MermaidGraph, probe *canvas) (*FlowLayout, error) {
	horizontal := g.Direction == "LR" || g.Direction == "RL"
	reversed := g.Direction == "BT" || g.Direction == "RL"

	// 1. 度量节点
	for _, n := range g.Nodes {
		f := probe.face(flowFont)
		n.textLines = wrapTextForWidth(f, n.Text, flowMaxTextW)
		maxW := 0.0
		for _, l := range n.textLines {
			if lw := measureText(f, l); lw > maxW {
				maxW = lw
			}
		}
		n.textLineWidth = []float64{maxW}
		w := maxW + 2*flowPadX
		h := float64(len(n.textLines))*lineHeight(flowFont) + 2*flowPadY
		switch n.Shape {
		case "circle":
			side := math.Max(w, h) + 16
			w, h = side, side
		case "diamond":
			w *= 1.45
			h *= 1.7
		case "hexagon":
			w += 26
		case "stadium":
			w += 12
		case "cylinder":
			h += 12
		case "parallelogram":
			w += 22
		case "subroutine":
			w += 16
		case "doc":
			h += 8
		}
		if w < 60 {
			w = 60
		}
		if h < 38 {
			h = 38
		}
		n.W, n.H = w, h
	}

	idx := map[*FlowNode]int{}
	for i, n := range g.Nodes {
		idx[n] = i
		n.Order = i
	}
	// 去重边（同向同源同目标保留一条）并剔除自环参与分层
	var dagEdges []*FlowEdge
	seen := map[[2]int]bool{}
	for _, e := range g.Edges {
		if e.From == e.To {
			continue
		}
		k := [2]int{idx[e.From], idx[e.To]}
		if seen[k] {
			continue
		}
		seen[k] = true
		dagEdges = append(dagEdges, e)
	}

	// 2. 最长路径分层（迭代松弛，天然容忍环）
	const maxLayer = 200
	for _, n := range g.Nodes {
		n.Layer = 0
	}
	for iter := 0; iter < len(g.Nodes)+1; iter++ {
		changed := false
		for _, e := range dagEdges {
			if e.To.Layer < e.From.Layer+1 && e.From.Layer+1 < maxLayer {
				e.To.Layer = e.From.Layer + 1
				changed = true
			}
		}
		if !changed {
			break
		}
	}

	// 3. 分层归组
	maxLayerNo := 0
	for _, n := range g.Nodes {
		if n.Layer > maxLayerNo {
			maxLayerNo = n.Layer
		}
	}
	layers := make([][]*FlowNode, maxLayerNo+1)
	for _, n := range g.Nodes {
		layers[n.Layer] = append(layers[n.Layer], n)
	}

	// 4. 重心排序一轮，减少连线交叉
	preds := map[*FlowNode][]*FlowNode{}
	for _, e := range dagEdges {
		preds[e.To] = append(preds[e.To], e.From)
	}
	for li := 1; li < len(layers); li++ {
		layer := layers[li]
		bary := func(n *FlowNode) float64 {
			ps := preds[n]
			if len(ps) == 0 {
				return float64(n.Order)
			}
			sum := 0.0
			for _, p := range ps {
				sum += float64(p.Order)
			}
			return sum / float64(len(ps))
		}
		stableSortFlow(layer, bary)
		for i, n := range layer {
			n.Order = i
		}
	}

	// 5. 计算每层的横轴尺寸与沿轴尺寸
	var crossSizes []float64 // 每层横轴总长
	var flowSizes []float64  // 每层沿轴最大厚度
	globalCross := 0.0
	for _, layer := range layers {
		cross := 0.0
		flow := 0.0
		for i, n := range layer {
			cs, fs := n.W, n.H
			if horizontal {
				cs, fs = n.H, n.W
			}
			cross += cs
			if i > 0 {
				cross += flowNodeGap
			}
			if fs > flow {
				flow = fs
			}
		}
		crossSizes = append(crossSizes, cross)
		flowSizes = append(flowSizes, flow)
		if cross > globalCross {
			globalCross = cross
		}
	}

	var flowStart []float64
	cursor := flowMargin
	totalFlow := 0.0
	for i := range layers {
		flowStart = append(flowStart, cursor)
		cursor += flowSizes[i] + flowLayerGap
		totalFlow = cursor
	}
	if len(layers) > 0 {
		totalFlow -= flowLayerGap
	}
	if reversed {
		for i := range flowStart {
			flowStart[i] = flowMargin + totalFlow - (flowStart[i] - flowMargin) - flowSizes[i]
		}
	}

	// 6. 落位
	for li, layer := range layers {
		bandStart := flowMargin + (globalCross-crossSizes[li])/2
		cur := bandStart
		for _, n := range layer {
			cs, fs := n.W, n.H
			if horizontal {
				cs, fs = n.H, n.W
			}
			off := flowStart[li] + (flowSizes[li]-fs)/2
			if horizontal {
				n.X, n.Y = off, cur
			} else {
				n.X, n.Y = cur, off
			}
			cur += cs + flowNodeGap
		}
	}

	lay := &FlowLayout{Graph: g, Horizontal: horizontal}
	maxX, maxY := 0.0, 0.0
	for _, n := range g.Nodes {
		if r := n.X + n.W; r > maxX {
			maxX = r
		}
		if b := n.Y + n.H; b > maxY {
			maxY = b
		}
	}
	lay.Width = maxX + flowMargin
	lay.Height = maxY + flowMargin

	// 7. 连线路径（正交折线：出边中点 → 层间中线 → 入边中点）
	for _, e := range g.Edges {
		e.Points = routeEdge(e, horizontal)
		if e.Label != "" {
			e.LabelX, e.LabelY = polylineMidpoint(e.Points)
		}
	}
	return lay, nil
}

func stableSortFlow(nodes []*FlowNode, key func(*FlowNode) float64) {
	// 简单插入排序，保持稳定
	for i := 1; i < len(nodes); i++ {
		cur := nodes[i]
		k := key(cur)
		j := i - 1
		for j >= 0 && key(nodes[j]) > k {
			nodes[j+1] = nodes[j]
			j--
		}
		nodes[j+1] = cur
	}
}

func routeEdge(e *FlowEdge, horizontal bool) [][2]float64 {
	s, t := e.From, e.To
	if s == t {
		// 自环：绕到节点右侧的小回路
		x := s.X + s.W
		y := s.Y + s.H/2
		return [][2]float64{
			{x, y - 8}, {x + 30, y - 8}, {x + 30, y + 18}, {x, y + 18},
		}
	}
	if !horizontal {
		goingDown := t.Y > s.Y
		sy := s.Y + s.H
		ty := t.Y
		if !goingDown {
			sy = s.Y
			ty = t.Y + t.H
		}
		sx := s.X + s.W/2
		tx := t.X + t.W/2
		midY := (sy + ty) / 2
		if math.Abs(sx-tx) < 1 {
			return [][2]float64{{sx, sy}, {tx, ty}}
		}
		return [][2]float64{{sx, sy}, {sx, midY}, {tx, midY}, {tx, ty}}
	}
	goingRight := t.X > s.X
	sx := s.X + s.W
	tx := t.X
	if !goingRight {
		sx = s.X
		tx = t.X + t.W
	}
	sy := s.Y + s.H/2
	ty := t.Y + t.H/2
	midX := (sx + tx) / 2
	if math.Abs(sy-ty) < 1 {
		return [][2]float64{{sx, sy}, {tx, ty}}
	}
	return [][2]float64{{sx, sy}, {midX, sy}, {midX, ty}, {tx, ty}}
}

func polylineMidpoint(pts [][2]float64) (float64, float64) {
	if len(pts) == 0 {
		return 0, 0
	}
	total := 0.0
	for i := 1; i < len(pts); i++ {
		total += math.Hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])
	}
	half := total / 2
	acc := 0.0
	for i := 1; i < len(pts); i++ {
		d := math.Hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])
		if acc+d >= half {
			ratio := 0.0
			if d > 0 {
				ratio = (half - acc) / d
			}
			return pts[i-1][0] + (pts[i][0]-pts[i-1][0])*ratio,
				pts[i-1][1] + (pts[i][1]-pts[i-1][1])*ratio
		}
		acc += d
	}
	last := pts[len(pts)-1]
	return last[0], last[1]
}

// BuildFlowchartMD 流程图导出为 Markdown（围栏 mermaid 代码块，可直接粘贴到支持 mermaid 的编辑器）。
func BuildFlowchartMD(content, title string) ([]byte, error) {
	var sb strings.Builder
	if strings.TrimSpace(title) != "" {
		sb.WriteString("# " + strings.TrimSpace(title) + "\n\n")
	}
	sb.WriteString("```mermaid\n")
	sb.WriteString(strings.TrimRight(content, "\n"))
	sb.WriteString("\n```\n")
	return []byte(sb.String()), nil
}

// BuildFlowchartSVG 流程图导出为 SVG（自绘分层布局，文字为矢量文本可缩放）。
func BuildFlowchartSVG(content string) ([]byte, error) {
	g, err := ParseMermaidFlowchart(content)
	if err != nil {
		return nil, err
	}
	probe, err := newCanvas(10, 10)
	if err != nil {
		return nil, err
	}
	lay, err := LayoutFlowchart(g, probe)
	if err != nil {
		return nil, err
	}
	w := int(math.Ceil(lay.Width))
	h := int(math.Ceil(lay.Height))
	if w < 320 {
		w = 320
	}
	if h < 200 {
		h = 200
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`, w, h, w, h))
	sb.WriteString(`<rect width="100%" height="100%" fill="#ffffff"/>`)
	sb.WriteString(`<style>text{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}` +
		`.n{font-size:13.5px;fill:#1f2329;}.lbl{font-size:11.5px;fill:#5f6672;}</style>`)
	sb.WriteString(`<defs><marker id="hk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
		`<path d="M 0 0 L 10 5 L 0 10 z" fill="#8a919f"/></marker></defs>`)

	// 连线
	for _, e := range g.Edges {
		if len(e.Points) < 2 {
			continue
		}
		stroke := "#8a919f"
		dash := ""
		if e.Dotted {
			dash = ` stroke-dasharray="5 4"`
		}
		width := "1.6"
		if e.Thick {
			width = "2.6"
		}
		d := "M " + fmtPt(e.Points[0])
		for _, p := range e.Points[1:] {
			d += " L " + fmtPt(p)
		}
		marker := ""
		if e.Arrow {
			marker = ` marker-end="url(#hk-arrow)"`
		}
		fmt.Fprintf(&sb, `<path d="%s" fill="none" stroke="%s" stroke-width="%s"%s%s/>`, d, stroke, width, dash, marker)
		if e.Label != "" {
			fmt.Fprintf(&sb, `<rect x="%.1f" y="%.1f" width="%.1f" height="16" rx="3" fill="#ffffff" fill-opacity="0.9"/>`,
				e.LabelX-measureLabelHalf(e.Label)-4, e.LabelY-8, measureLabelHalf(e.Label)*2+8)
			fmt.Fprintf(&sb, `<text class="lbl" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`,
				e.LabelX, e.LabelY+3.5, escapeXML(e.Label))
		}
	}
	// 节点
	for _, n := range g.Nodes {
		sb.WriteString(svgNodeShape(n))
		lineH := lineHeight(flowFont)
		total := float64(len(n.textLines)) * lineH
		startY := n.Y + (n.H-total)/2 + lineH*0.72
		cx := n.X + n.W/2
		fmt.Fprintf(&sb, `<text class="n" x="%.1f" y="%.1f" text-anchor="middle">`, cx, startY)
		for i, line := range n.textLines {
			dy := "0"
			if i > 0 {
				dy = fmt.Sprintf("%.1f", lineH)
			}
			fmt.Fprintf(&sb, `<tspan x="%.1f" dy="%s">%s</tspan>`, cx, dy, escapeXML(line))
		}
		sb.WriteString(`</text>`)
	}
	sb.WriteString(`</svg>`)
	return []byte(sb.String()), nil
}

func measureLabelHalf(label string) float64 {
	// 标签以 11.5px 估算：中文按 11.5 宽、其它按 6.2 宽
	w := 0.0
	for _, r := range label {
		if r > 0x2e80 {
			w += 11.5
		} else {
			w += 6.2
		}
	}
	return w / 2
}

func fmtPt(p [2]float64) string {
	return fmt.Sprintf("%.1f %.1f", p[0], p[1])
}

func svgNodeShape(n *FlowNode) string {
	fill := "#ffffff"
	stroke := "#c9d0d8"
	x, y, w, h := n.X, n.Y, n.W, n.H
	switch n.Shape {
	case "round", "stadium":
		return fmt.Sprintf(`<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x, y, w, h, h/2, fill, stroke)
	case "circle":
		return fmt.Sprintf(`<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x+w/2, y+h/2, w/2, h/2, fill, stroke)
	case "diamond":
		return fmt.Sprintf(`<polygon points="%.1f,%.1f %.1f,%.1f %.1f,%.1f %.1f,%.1f" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x+w/2, y, x+w, y+h/2, x+w/2, y+h, x, y+h/2, fill, stroke)
	case "hexagon":
		c := math.Min(16, w/4)
		return fmt.Sprintf(`<polygon points="%.1f,%.1f %.1f,%.1f %.1f,%.1f %.1f,%.1f %.1f,%.1f %.1f,%.1f" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x+c, y, x+w-c, y, x+w, y+h/2, x+w-c, y+h, x+c, y+h, x, y+h/2, fill, stroke)
	case "parallelogram":
		c := math.Min(16, w/4)
		return fmt.Sprintf(`<polygon points="%.1f,%.1f %.1f,%.1f %.1f,%.1f %.1f,%.1f" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x+c, y, x+w, y, x+w-c, y+h, x, y+h, fill, stroke)
	case "subroutine":
		return fmt.Sprintf(`<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="3" fill="%s" stroke="%s" stroke-width="1.6"/>`+
			`<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1.2"/>`+
			`<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1.2"/>`,
			x, y, w, h, fill, stroke,
			x+7, y, x+7, y+h, stroke,
			x+w-7, y, x+w-7, y+h, stroke)
	case "cylinder":
		ry := 7.0
		return fmt.Sprintf(`<path d="M %.1f %.1f L %.1f %.1f A %.1f %.1f 0 0 0 %.1f %.1f L %.1f %.1f A %.1f %.1f 0 0 0 %.1f %.1f Z" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x, y+ry, x, y+h-ry, w/2, ry, x+w, y+h-ry, x+w, y+ry, w/2, ry, x, y+ry, fill, stroke)
	case "doc":
		return fmt.Sprintf(`<path d="M %.1f %.1f L %.1f %.1f L %.1f %.1f Q %.1f %.1f %.1f %.1f L %.1f %.1f L %.1f %.1f Z" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x, y, x+w, y, x+w, y+h-6, x+w-w*0.25, y+h+4, x+w*0.5, y+h-6, x, y+h-6, x, y, fill, stroke)
	default:
		return fmt.Sprintf(`<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="6" fill="%s" stroke="%s" stroke-width="1.6"/>`,
			x, y, w, h, fill, stroke)
	}
}

// BuildFlowchartPNG 流程图导出为 PNG（与 SVG 同一套布局，位图栅格化）。
func BuildFlowchartPNG(content string) ([]byte, error) {
	g, err := ParseMermaidFlowchart(content)
	if err != nil {
		return nil, err
	}
	probe, err := newCanvas(10, 10)
	if err != nil {
		return nil, err
	}
	lay, err := LayoutFlowchart(g, probe)
	if err != nil {
		return nil, err
	}
	scale := 2.0
	maxDim := 8000.0
	if lay.Width*scale > maxDim || lay.Height*scale > maxDim {
		scale = minFloat(maxDim/lay.Width, maxDim/lay.Height)
		if scale < 1 {
			scale = 1
		}
	}
	w, h := int(lay.Width*scale), int(lay.Height*scale)
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

	// 连线
	for _, e := range g.Edges {
		if len(e.Points) < 2 {
			continue
		}
		col := [3]uint8{138, 145, 159}
		var dash []float64
		if e.Dotted {
			dash = []float64{5, 4}
		}
		lineW := 1.6
		if e.Thick {
			lineW = 2.6
		}
		c.strokeLine(e.Points, col, lineW, dash)
		if e.Arrow {
			last := e.Points[len(e.Points)-1]
			prev := e.Points[len(e.Points)-2]
			angle := math.Atan2(last[1]-prev[1], last[0]-prev[0])
			c.drawArrowHead(last[0], last[1], angle, 9, col)
		}
	}
	// 标签
	for _, e := range g.Edges {
		if e.Label == "" {
			continue
		}
		half := measureLabelHalf(e.Label)
		c.fillRoundRect(e.LabelX-half-4, e.LabelY-9, half*2+8, 18, 3,
			[3]uint8{255, 255, 255}, [3]uint8{255, 255, 255}, 0)
		c.drawStringCentered(e.Label, e.LabelX-half-4, e.LabelY-9, half*2+8, 18, flowLabelFont, [3]uint8{95, 102, 114})
	}
	// 节点
	for _, n := range g.Nodes {
		drawFlowNodePNG(c, n)
	}

	buf := &bytes.Buffer{}
	if err := png.Encode(buf, c.dc.Image()); err != nil {
		return nil, fmt.Errorf("生成 PNG 失败：%v", err)
	}
	return buf.Bytes(), nil
}

func drawFlowNodePNG(c *canvas, n *FlowNode) {
	fill := [3]uint8{255, 255, 255}
	stroke := [3]uint8{201, 208, 216}
	x, y, w, h := n.X, n.Y, n.W, n.H

	// gg 在 Fill()/Stroke() 后会清空当前路径，因此填充与描边各自重建一次路径
	buildPath := func() {
		c.dc.NewSubPath()
		switch n.Shape {
		case "round", "stadium":
			c.dc.DrawRoundedRectangle(x, y, w, h, h/2)
		case "circle":
			c.dc.DrawEllipse(x+w/2, y+h/2, w/2, h/2)
		case "diamond":
			c.dc.MoveTo(x+w/2, y)
			c.dc.LineTo(x+w, y+h/2)
			c.dc.LineTo(x+w/2, y+h)
			c.dc.LineTo(x, y+h/2)
			c.dc.ClosePath()
		case "hexagon":
			cc := math.Min(16, w/4)
			c.dc.MoveTo(x+cc, y)
			c.dc.LineTo(x+w-cc, y)
			c.dc.LineTo(x+w, y+h/2)
			c.dc.LineTo(x+w-cc, y+h)
			c.dc.LineTo(x+cc, y+h)
			c.dc.LineTo(x, y+h/2)
			c.dc.ClosePath()
		case "parallelogram":
			cc := math.Min(16, w/4)
			c.dc.MoveTo(x+cc, y)
			c.dc.LineTo(x+w, y)
			c.dc.LineTo(x+w-cc, y+h)
			c.dc.LineTo(x, y+h)
			c.dc.ClosePath()
		default:
			c.dc.DrawRoundedRectangle(x, y, w, h, 6)
		}
	}

	buildPath()
	setRGB(c.dc, fill)
	c.dc.Fill()
	buildPath()
	setRGB(c.dc, stroke)
	c.dc.SetLineWidth(1.6)
	c.dc.Stroke()

	// subroutine（子流程）额外补两条竖线
	if n.Shape == "subroutine" {
		c.strokeLine([][2]float64{{x + 7, y}, {x + 7, y + h}}, stroke, 1.2, nil)
		c.strokeLine([][2]float64{{x + w - 7, y}, {x + w - 7, y + h}}, stroke, 1.2, nil)
	}
	// 文字
	lineH := lineHeight(flowFont)
	c.drawStringWrapped(n.textLines, x, y, w, h, lineH, flowFont, rgbText)
}
