package exportx

import "fmt"

// AutoCAD 颜色索引（ACI）→ #rrggbb。
//
// 说明：1–9 与 250–255 是标准固定值，直接查表；10–249 是 24 个色相 × 10 级明度的
// 规则排列，这里按同一规则近似合成 —— 本模块产出的是"预览图"而非出图，
// 近似色相不影响可读性，但 ACI 7（随背景自动反色）必须映射为深色，
// 否则默认图层在白色画布上将不可见。
func aciHex(aci int) string {
	fixed := map[int][3]int{
		1: {255, 0, 0}, 2: {255, 255, 0}, 3: {0, 255, 0}, 4: {0, 255, 255},
		5: {0, 0, 255}, 6: {255, 0, 255},
		7: {0, 0, 0}, // 白底上用黑色，见上方说明
		8: {128, 128, 128}, 9: {192, 192, 192},
		250: {51, 51, 51}, 251: {91, 91, 91}, 252: {132, 132, 132},
		253: {173, 173, 173}, 254: {214, 214, 214}, 255: {255, 255, 255},
	}
	if c, ok := fixed[aci]; ok {
		return rgbHex(c[0], c[1], c[2])
	}
	if aci < 10 || aci > 249 {
		return "#000000"
	}
	// 10–249：24 个色相，每色相 10 级
	n := aci - 10
	hue := float64(n/10) * 15 // 0,15,...,345
	shade := n % 10
	// shade 0 最深、9 最亮；饱和度随之衰减，接近 CAD 的观感
	light := 0.18 + float64(shade)*0.085
	sat := 1.0
	if shade >= 8 {
		sat = 1.0 - float64(shade-8)*0.45
	}
	r, g, b := hslToRGB(hue, sat, light)
	return rgbHex(r, g, b)
}

func rgbHex(r, g, b int) string {
	return fmt.Sprintf("#%02x%02x%02x", clamp255(r), clamp255(g), clamp255(b))
}

func clamp255(v int) int {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return v
}

// hslToRGB h∈[0,360)，s/l∈[0,1]，返回 0-255。
func hslToRGB(h, s, l float64) (int, int, int) {
	if s <= 0 {
		v := int(l*255 + 0.5)
		return v, v, v
	}
	var q float64
	if l < 0.5 {
		q = l * (1 + s)
	} else {
		q = l + s - l*s
	}
	p := 2*l - q
	hue2rgb := func(t float64) float64 {
		if t < 0 {
			t++
		}
		if t > 1 {
			t--
		}
		switch {
		case t < 1.0/6:
			return p + (q-p)*6*t
		case t < 1.0/2:
			return q
		case t < 2.0/3:
			return p + (q-p)*(2.0/3-t)*6
		default:
			return p
		}
	}
	h /= 360
	return int(hue2rgb(h+1.0/3)*255 + 0.5), int(hue2rgb(h)*255 + 0.5), int(hue2rgb(h-1.0/3)*255 + 0.5)
}
