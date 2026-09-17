package exportx

// CAD 图元的渲染：SVG（矢量）与 PNG（栅格）。
//
// 两条路径共用同一份离散化几何（cadDrawing）与同一个"世界坐标 → 设备坐标"
// 变换，只在输出形式上不同，避免 SVG 与 PNG 观感不一致。
// PNG 复用 exportx 既有的 gg + freetype 管线（含 CJK 字体处理）。

import (
	"bytes"
	"fmt"
	"html"
	"math"
	"strings"
)

// cadRenderOpts 渲染参数。
type cadRenderOpts struct {
	// 目标画布尺寸上限（像素）；实际尺寸按图幅比例适配
	MaxW, MaxH int
	// 四周留白（像素）
	Padding float64
	// 是否输出白色背景
	Background bool
}

func defaultCadOpts() cadRenderOpts {
	return cadRenderOpts{MaxW: 1600, MaxH: 1200, Padding: 24, Background: true}
}

// cadViewport 世界坐标 → 设备坐标的变换结果。
type cadViewport struct {
	Scale  float64
	OffX   float64
	OffY   float64
	W, H   int
	MaxY   float64
	MinX   float64
	Stroke float64 // 默认线宽（设备像素）
}

// newViewport 由图幅与目标尺寸计算视口。Y 轴翻转（DXF 向上，屏幕向下）。
func newViewport(d *cadDrawing, o cadRenderOpts) cadViewport {
	w := math.Max(d.Width(), 1e-6)
	h := math.Max(d.Height(), 1e-6)
	pad := o.Padding
	innerW := float64(o.MaxW) - pad*2
	innerH := float64(o.MaxH) - pad*2
	if innerW <= 1 {
		innerW = 1
	}
	if innerH <= 1 {
		innerH = 1
	}
	scale := math.Min(innerW/w, innerH/h)
	// 视口尺寸 = 图幅等比放大后的尺寸 + 留白；同时受上限约束
	vw := int(math.Round(w*scale + pad*2))
	vh := int(math.Round(h*scale + pad*2))
	if vw < 1 {
		vw = 1
	}
	if vh < 1 {
		vh = 1
	}
	// 居中：图幅小于画布时把内容推到中间
	offX := (float64(vw) - w*scale) / 2
	offY := (float64(vh) - h*scale) / 2
	return cadViewport{
		Scale:  scale,
		OffX:   offX,
		OffY:   offY,
		W:      vw,
		H:      vh,
		MaxY:   d.Max.Y,
		MinX:   d.Min.X,
		Stroke: math.Max(1, scale*0.25),
	}
}

// pt 世界坐标 → 设备坐标。
func (v cadViewport) pt(p cadPt) (float64, float64) {
	x := (p.X-v.MinX)*v.Scale + v.OffX
	y := (v.MaxY-p.Y)*v.Scale + v.OffY
	return x, y
}

// ---------- SVG ----------

// BuildCadSVG 把图元渲染为 SVG。viewBox 与像素尺寸一致，便于前端直接等比缩放。
func BuildCadSVG(d *cadDrawing) ([]byte, error) {
	return buildCadSVG(d, defaultCadOpts())
}

func buildCadSVG(d *cadDrawing, o cadRenderOpts) ([]byte, error) {
	v := newViewport(d, o)
	var sb strings.Builder
	sb.Grow(1 << 16)
	fmt.Fprintf(&sb, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" `+
		`preserveAspectRatio="xMidYMid meet" font-family="PingFang SC, Microsoft YaHei, Helvetica, Arial, sans-serif">`,
		v.W, v.H, v.W, v.H)
	if o.Background {
		fmt.Fprintf(&sb, `<rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>`, v.W, v.H)
	}
	// 坐标轴原点标记（十字），便于确认图幅方向
	sb.WriteString(`<g stroke-linecap="round" stroke-linejoin="round" fill="none">`)

	for _, pl := range d.Polylines {
		if len(pl.Pts) < 2 {
			continue
		}
		pts := make([]string, 0, len(pl.Pts))
		for _, p := range pl.Pts {
			x, y := v.pt(p)
			pts = append(pts, fmt.Sprintf("%.2f,%.2f", x, y))
		}
		lw := v.Stroke
		fmt.Fprintf(&sb, `<polyline points="%s" stroke="%s" stroke-width="%.2f"/>`,
			strings.Join(pts, " "), pl.Color, lw)
	}
	sb.WriteString(`</g>`)

	for _, t := range d.Texts {
		x, y := v.pt(t.Pos)
		size := t.Height * v.Scale
		if size < 6 {
			size = 6 // 极小字在预览里不可读，抬到可读下限
		}
		esc := html.EscapeString(t.Content)
		if math.Abs(t.Rotation) > 0.01 {
			// 屏幕 Y 轴朝下，故旋转角取反
			fmt.Fprintf(&sb, `<text x="%.2f" y="%.2f" font-size="%.2f" fill="%s" transform="rotate(%.2f %.2f %.2f)">%s</text>`,
				x, y, size, t.Color, -t.Rotation, x, y, esc)
		} else {
			fmt.Fprintf(&sb, `<text x="%.2f" y="%.2f" font-size="%.2f" fill="%s">%s</text>`,
				x, y, size, t.Color, esc)
		}
	}
	sb.WriteString(`</svg>`)
	return []byte(sb.String()), nil
}

// ---------- PNG ----------

// BuildCadPNG 把图元栅格化为 PNG。
func BuildCadPNG(d *cadDrawing) ([]byte, error) {
	return buildCadPNG(d, defaultCadOpts())
}

func buildCadPNG(d *cadDrawing, o cadRenderOpts) ([]byte, error) {
	v := newViewport(d, o)
	c, err := newCanvas(v.W, v.H)
	if err != nil {
		return nil, err
	}
	for _, pl := range d.Polylines {
		if len(pl.Pts) < 2 {
			continue
		}
		dev := make([][2]float64, 0, len(pl.Pts))
		for _, p := range pl.Pts {
			x, y := v.pt(p)
			dev = append(dev, [2]float64{x, y})
		}
		c.strokeLine(dev, hexToRGB(pl.Color), v.Stroke, nil)
	}
	for _, t := range d.Texts {
		x, y := v.pt(t.Pos)
		size := t.Height * v.Scale
		if size < 6 {
			size = 6
		}
		col := hexToRGB(t.Color)
		if math.Abs(t.Rotation) > 0.01 {
			c.dc.Push()
			c.dc.RotateAbout(-t.Rotation*math.Pi/180, x, y)
			c.drawString(t.Content, x, y, size, col)
			c.dc.Pop()
		} else {
			c.drawString(t.Content, x, y, size, col)
		}
	}
	var buf bytes.Buffer
	if err := c.dc.EncodePNG(&buf); err != nil {
		return nil, fmt.Errorf("PNG 编码失败：%v", err)
	}
	return buf.Bytes(), nil
}

// hexToRGB 把 #rrggbb 解析为 RGB 三元组；失败返回深灰。
func hexToRGB(s string) [3]uint8 {
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	if len(s) != 6 {
		return [3]uint8{31, 35, 41}
	}
	var v [3]uint8
	for i := 0; i < 3; i++ {
		var b byte
		for j := 0; j < 2; j++ {
			ch := s[i*2+j]
			var d byte
			switch {
			case ch >= '0' && ch <= '9':
				d = ch - '0'
			case ch >= 'a' && ch <= 'f':
				d = ch - 'a' + 10
			case ch >= 'A' && ch <= 'F':
				d = ch - 'A' + 10
			default:
				return [3]uint8{31, 35, 41}
			}
			b = b<<4 | d
		}
		v[i] = b
	}
	return v
}
