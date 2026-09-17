package exportx

import (
	"fmt"
	"math"
	"strings"

	"github.com/fogleman/gg"
	"github.com/golang/freetype/truetype"
	"golang.org/x/image/font"
)

func cos(a float64) float64 { return math.Cos(a) }
func sin(a float64) float64 { return math.Sin(a) }

// 导出图形的统一视觉规范（与前端阅读态配色保持一致）。
var (
	rgbBg       = [3]uint8{255, 255, 255}
	rgbLine     = [3]uint8{201, 208, 216}
	rgbText     = [3]uint8{31, 35, 41}
	rgbRootFill = [3]uint8{47, 84, 235}
	rgbRootText = [3]uint8{255, 255, 255}
	rgbLevel1   = [3]uint8{224, 231, 245}
	rgbLevel1Tx = [3]uint8{31, 35, 41}
	rgbLevel2   = [3]uint8{232, 246, 245}
	rgbLevel3   = [3]uint8{246, 240, 252}
	rgbAccent   = [3]uint8{47, 84, 235}
)

func setRGB(dc *gg.Context, c [3]uint8) {
	dc.SetRGB(float64(c[0])/255, float64(c[1])/255, float64(c[2])/255)
}

func hexRGB(c [3]uint8) string {
	return fmt.Sprintf("#%02x%02x%02x", c[0], c[1], c[2])
}

// canvas 封装 gg 画布与字体，提供度量与折行能力。
type canvas struct {
	dc   *gg.Context
	font *truetype.Font
}

func newCanvas(w, h int) (*canvas, error) {
	raw, err := LoadFont()
	if err != nil {
		return nil, err
	}
	f, err := truetype.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("中文字体解析失败：%v", err)
	}
	dc := gg.NewContext(w, h)
	setRGB(dc, rgbBg)
	dc.Clear()
	return &canvas{dc: dc, font: f}, nil
}

// face 返回指定字号的字体面（DPI=72，1pt = 1px）。
func (c *canvas) face(size float64) font.Face {
	return truetype.NewFace(c.font, &truetype.Options{Size: size, DPI: 72})
}

// measure 文本宽度（像素）。
func measureText(f font.Face, s string) float64 {
	if s == "" {
		return 0
	}
	return float64(font.MeasureString(f, s)) / 64.0
}

// wrapTextForWidth 按像素宽度折行（优先空格断行，中文逐字断行）。
func wrapTextForWidth(f font.Face, text string, maxWidth float64) []string {
	var lines []string
	for _, hard := range strings.Split(text, "\n") {
		if strings.TrimSpace(hard) == "" {
			lines = append(lines, "")
			continue
		}
		runes := []rune(hard)
		var cur []rune
		curW := 0.0
		lastSpace := -1
		for _, r := range runes {
			rw := measureText(f, string(r))
			if curW+rw > maxWidth && len(cur) > 0 {
				if lastSpace > 0 && len(cur)-lastSpace < 24 {
					rest := append([]rune(nil), cur[lastSpace+1:]...)
					lines = append(lines, string(cur[:lastSpace]))
					cur = rest
					curW = measureText(f, string(cur))
				} else {
					lines = append(lines, string(cur))
					cur = nil
					curW = 0
				}
				lastSpace = -1
			}
			if r == ' ' {
				lastSpace = len(cur)
				if len(cur) == 0 {
					continue
				}
			}
			cur = append(cur, r)
			curW += rw
		}
		if len(cur) > 0 {
			lines = append(lines, string(cur))
		}
	}
	if len(lines) == 0 {
		lines = []string{""}
	}
	return lines
}

// drawString 在 (x,y) 以 left-baseline 绘制文本。
func (c *canvas) drawString(s string, x, y, size float64, col [3]uint8) {
	if s == "" {
		return
	}
	c.dc.SetFontFace(c.face(size))
	setRGB(c.dc, col)
	c.dc.DrawString(s, x, y)
}

// drawStringCentered 在给定矩形内水平+垂直居中绘制文本。
func (c *canvas) drawStringCentered(s string, x, y, w, h, size float64, col [3]uint8) {
	if s == "" {
		return
	}
	f := c.face(size)
	c.dc.SetFontFace(f)
	setRGB(c.dc, col)
	c.dc.DrawStringAnchored(s, x+w/2, y+h/2, 0.5, 0.5)
}

// drawStringWrapped 在矩形内绘制多行文本（垂直居中），返回实际行数。
func (c *canvas) drawStringWrapped(lines []string, x, y, w, h, lineH, size float64, col [3]uint8) {
	total := float64(len(lines)) * lineH
	startY := y + (h-total)/2 + lineH*0.72
	for i, line := range lines {
		c.drawStringCentered(line, x, startY+float64(i)*lineH-lineH*0.72, w, lineH, size, col)
	}
}

// fillRoundRect 圆角矩形填充 + 描边。
func (c *canvas) fillRoundRect(x, y, w, h, r float64, fill [3]uint8, stroke [3]uint8, lineW float64) {
	c.dc.NewSubPath()
	c.dc.DrawRoundedRectangle(x, y, w, h, r)
	setRGB(c.dc, fill)
	c.dc.Fill()
	if lineW > 0 {
		c.dc.NewSubPath()
		c.dc.DrawRoundedRectangle(x, y, w, h, r)
		setRGB(c.dc, stroke)
		c.dc.SetLineWidth(lineW)
		c.dc.Stroke()
	}
}

// strokeLine 折线描边。
func (c *canvas) strokeLine(pts [][2]float64, col [3]uint8, lineW float64, dash []float64) {
	if len(pts) < 2 {
		return
	}
	c.dc.NewSubPath()
	c.dc.SetDash(dash...)
	setRGB(c.dc, col)
	c.dc.SetLineWidth(lineW)
	for i, p := range pts {
		if i == 0 {
			c.dc.MoveTo(p[0], p[1])
		} else {
			c.dc.LineTo(p[0], p[1])
		}
	}
	c.dc.Stroke()
	c.dc.SetDash()
}

// drawArrowHead 在 (x,y) 处按方向角绘制实心箭头。
func (c *canvas) drawArrowHead(x, y, angle, size float64, col [3]uint8) {
	const spread = 0.42
	p1x := x - size*cos(angle-spread)
	p1y := y - size*sin(angle-spread)
	p2x := x - size*cos(angle+spread)
	p2y := y - size*sin(angle+spread)
	c.dc.NewSubPath()
	c.dc.MoveTo(x, y)
	c.dc.LineTo(p1x, p1y)
	c.dc.LineTo(p2x, p2y)
	c.dc.ClosePath()
	setRGB(c.dc, col)
	c.dc.Fill()
}

// drawBezier 三次贝塞尔曲线（用于思维导图连线）。
func (c *canvas) drawBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2 float64, col [3]uint8, lineW float64) {
	c.dc.NewSubPath()
	setRGB(c.dc, col)
	c.dc.SetLineWidth(lineW)
	c.dc.MoveTo(x1, y1)
	c.dc.CubicTo(cx1, cy1, cx2, cy2, x2, y2)
	c.dc.Stroke()
}
