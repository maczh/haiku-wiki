package exportx

// AutoCAD DXF / DWG 解析与几何构建。
//
// 设计取舍：
//  1. DXF 是纯文本且规范公开，这里自行解析常用实体子集，不引入第三方依赖；
//  2. DWG 是专有二进制格式，无法自行解析 —— 通过外部转换器
//     （libredwg 的 dwg2dxf/dwgread，或 ODA File Converter）先转成 DXF，
//     再复用同一套渲染器（见 cad_converter.go）；
//  3. 所有曲线（圆/弧/椭圆/多段线凸度）在解析阶段离散化为折线，
//     使 SVG 与 PNG 两条渲染路径共用同一份几何数据，避免两套曲线代码走样。

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ---------- 几何模型 ----------

// cadPt 二维点（DXF 世界坐标，Y 轴向上）。
type cadPt struct{ X, Y float64 }

// cadPolyline 一条离散化后的折线（可能只有 2 个点）。
type cadPolyline struct {
	Pts    []cadPt
	Closed bool
	Color  string // #rrggbb
	Width  float64
}

// cadText 单行文字。
type cadText struct {
	Pos      cadPt
	Content  string
	Height   float64 // 字高（世界单位）
	Rotation float64 // 度，逆时针
	Color    string
}

// cadDrawing 解析结果：可直接用于渲染。
type cadDrawing struct {
	Polylines []cadPolyline
	Texts     []cadText
	Min, Max  cadPt // 包围盒（世界坐标）
	Units     int   // $INSUNITS，0=无单位
	Layers    int   // 出现的图层数（诊断用）
}

// Width 包围盒宽（可能为 0，调用方需兜底）。
func (d *cadDrawing) Width() float64  { return d.Max.X - d.Min.X }
func (d *cadDrawing) Height() float64 { return d.Max.Y - d.Min.Y }

// ---------- DXF 标签流 ----------

type dxfTag struct {
	Code  int
	Value string
}

// errBinaryDXF 二进制 DXF（少见）无法按标签流解析。
var errBinaryDXF = fmt.Errorf("二进制 DXF 暂不支持，请另存为 ASCII DXF 后重试")

// parseDXFTags 把 DXF 文本切成 (组码, 值) 序列。
// 组码与值各占一行，因此按行成对读取；容忍 BOM、CRLF 与首尾空行。
func parseDXFTags(data []byte) ([]dxfTag, error) {
	if len(data) >= 22 && strings.HasPrefix(string(data[:22]), "AutoCAD Binary DXF") {
		return nil, errBinaryDXF
	}
	text := string(data)
	text = strings.TrimPrefix(text, "\ufeff")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	tags := make([]dxfTag, 0, len(lines)/2+1)
	for i := 0; i+1 < len(lines); i += 2 {
		codeStr := strings.TrimSpace(lines[i])
		if codeStr == "" {
			// 空行会让后续组码错位，直接跳过这一对继续尝试
			continue
		}
		code, err := strconv.Atoi(codeStr)
		if err != nil {
			return nil, fmt.Errorf("DXF 组码解析失败（第 %d 行：%q）", i+1, codeStr)
		}
		tags = append(tags, dxfTag{Code: code, Value: strings.TrimRight(lines[i+1], " \t")})
	}
	if len(tags) == 0 {
		return nil, fmt.Errorf("文件内容为空或不是有效的 DXF")
	}
	return tags, nil
}

// ---------- 实体中间表示（解析期使用，未离散化） ----------

type dxfEntity struct {
	kind string // LINE|LWPOLYLINE|POLYLINE|CIRCLE|ARC|ELLIPSE|TEXT|MTEXT|SOLID|POINT|INSERT|SPLINE|LEADER

	pts    []cadPt
	bulges []float64
	closed bool

	center   cadPt
	radius   float64
	a1, a2   float64 // ARC 起止角（度）
	major    cadPt   // ELLIPSE 长轴端点（相对圆心）
	ratio    float64 // ELLIPSE 短长轴比
	p1, p2   float64 // ELLIPSE 起止参数（弧度）
	hasParam bool

	text     string
	height   float64
	rotation float64

	block          string
	scaleX, scaleY float64

	color int // ACI 索引；0=ByBlock，256=ByLayer
	layer string
}

// ---------- 解析 ----------

// ParseDXF 解析 ASCII DXF，返回可直接渲染的图元集合。
func ParseDXF(data []byte) (*cadDrawing, error) {
	tags, err := parseDXFTags(data)
	if err != nil {
		return nil, err
	}

	p := &dxfParser{
		tags:      tags,
		blocks:    map[string][]dxfEntity{},
		blockBase: map[string]cadPt{},
		layerCol:  map[string]int{},
	}
	if err := p.run(); err != nil {
		return nil, err
	}

	d := &cadDrawing{Units: p.insUnits}
	p.emit(p.entities, cadPt{}, [2]float64{1, 1}, 0, 0, d)

	// 包围盒优先用 HEADER 的 $EXTMIN/$EXTMAX（更接近 CAD 的"图形范围"），
	// 缺失或退化时回退到实际图元范围。
	if p.hasExtents && p.extMax.X > p.extMin.X && p.extMax.Y > p.extMin.Y {
		d.Min, d.Max = p.extMin, p.extMax
	} else {
		d.computeBounds()
	}
	if d.Max.X <= d.Min.X && d.Max.Y <= d.Min.Y {
		return nil, fmt.Errorf("DXF 中未找到可渲染的图元（可能为空图或只含不支持的实体）")
	}
	return d, nil
}

type dxfParser struct {
	tags []dxfTag

	entities  []dxfEntity
	blocks    map[string][]dxfEntity
	blockBase map[string]cadPt
	layerCol  map[string]int
	layers    map[string]bool

	insUnits   int
	extMin     cadPt
	extMax     cadPt
	hasExtents bool

	// 解析游标
	i        int
	section  string
	polyline *dxfEntity // 正在收集 VERTEX 的 POLYLINE
	inBlock  string
}

func (p *dxfParser) run() error {
	// 顺序扫描一遍。注意两点（都由单测暴露过）：
	//  1. HEADER 里的变量是「组码 9 + 变量名」，不能只处理组码 0 的标签，
	//     否则 $INSUNITS / $EXTMIN / $EXTMAX 永远读不到；
	//  2. BLOCKS 段内的实体属于当前块定义（由 p.inBlock 决定归属），
	//     不能混进顶层实体列表，否则 INSERT 展开时查不到块内容。
	for p.i = 0; p.i < len(p.tags); p.i++ {
		t := p.tags[p.i]
		if t.Code != 0 {
			if p.section == "HEADER" && t.Code == 9 {
				p.headerTag(t)
			}
			continue
		}
		switch strings.ToUpper(t.Value) {
		case "SECTION":
			p.section = strings.ToUpper(p.peekValue(2))
			continue
		case "ENDSEC":
			p.section = ""
			continue
		case "BLOCK":
			p.inBlock = p.peekValue(2)
			p.blockBase[p.inBlock] = cadPt{X: p.peekFloat(10), Y: p.peekFloat(20)}
			continue
		case "ENDBLK":
			p.inBlock = ""
			continue
		case "VERTEX":
			p.consumeVertex()
			continue
		case "SEQEND":
			p.endPolyline()
			continue
		case "EOF":
			return nil
		}
		switch p.section {
		case "TABLES":
			p.tableTag(t)
		case "BLOCKS", "ENTITIES":
			p.entityTag(t)
		}
	}
	return nil
}

// peekValue 读取紧随其后的、指定组码的值（不移动游标）。
func (p *dxfParser) peekValue(code int) string {
	for j := p.i + 1; j < len(p.tags) && p.tags[j].Code != 0; j++ {
		if p.tags[j].Code == code {
			return p.tags[j].Value
		}
	}
	return ""
}

func (p *dxfParser) peekFloat(code int) float64 {
	f, _ := parseDxfFloat(p.peekValue(code))
	return f
}

func (p *dxfParser) headerTag(t dxfTag) {
	switch strings.ToUpper(strings.TrimSpace(t.Value)) {
	case "$INSUNITS":
		p.insUnits = int(p.peekFloat(70))
	case "$EXTMIN":
		p.extMin = cadPt{X: p.peekFloat(10), Y: p.peekFloat(20)}
		p.hasExtents = true
	case "$EXTMAX":
		p.extMax = cadPt{X: p.peekFloat(10), Y: p.peekFloat(20)}
		p.hasExtents = true
	}
}

func (p *dxfParser) tableTag(t dxfTag) {
	switch strings.ToUpper(t.Value) {
	case "LAYER":
		name := p.peekValue(2)
		if name != "" {
			p.layerCol[name] = int(p.peekFloat(62))
		}
	}
}

// entityTag 处理 ENTITIES / BLOCKS 段内的实体起始标签。
func (p *dxfParser) entityTag(t dxfTag) {
	kind := strings.ToUpper(t.Value)
	switch kind {
	case "LWPOLYLINE":
		e := p.newEntity(kind)
		e.closed = hasFlag(int(p.peekFloat(70)), 1)
		return
	case "POLYLINE":
		e := p.newEntity("POLYLINE")
		e.closed = hasFlag(int(p.peekFloat(70)), 1)
		p.polyline = e
		return
	case "CIRCLE", "ARC", "ELLIPSE", "TEXT", "MTEXT", "SOLID", "POINT",
		"INSERT", "LINE", "SPLINE", "LEADER", "3DFACE", "TRACE", "ATTDEF", "ATTRIB", "DIMENSION":
		p.newEntity(kind)
		return
	}
}

// newEntity 建立实体、读取其公共属性，并按「当前是否在 BLOCK 内」决定归属。
// 返回指向该实体的指针，便于 POLYLINE 后续收集 VERTEX。
func (p *dxfParser) newEntity(kind string) *dxfEntity {
	e := dxfEntity{kind: kind, scaleX: 1, scaleY: 1, ratio: 1}
	p.fillCommon(&e)
	if p.inBlock != "" {
		p.blocks[p.inBlock] = append(p.blocks[p.inBlock], e)
		return &p.blocks[p.inBlock][len(p.blocks[p.inBlock])-1]
	}
	p.entities = append(p.entities, e)
	return &p.entities[len(p.entities)-1]
}

// fillCommon 读取实体公共属性（图层/颜色/坐标/尺寸）。实体属性都跟在起始标签之后。
func (p *dxfParser) fillCommon(e *dxfEntity) {
	end := p.i + 1
	for end < len(p.tags) && p.tags[end].Code != 0 {
		end++
	}
	var vertIdx = -1
	for j := p.i + 1; j < end; j++ {
		t := p.tags[j]
		f, _ := parseDxfFloat(t.Value)
		switch t.Code {
		case 8:
			e.layer = t.Value
			if p.layers == nil {
				p.layers = map[string]bool{}
			}
			p.layers[t.Value] = true
		case 62:
			e.color = int(f)
		case 420: // 真彩色（24bit）
			e.color = -int(f) // 负值编码真彩，渲染时区分
		case 10:
			// LWPOLYLINE 的 10/20 会重复出现，每出现一次 10 即新增一个顶点
			if e.kind == "LWPOLYLINE" {
				e.pts = append(e.pts, cadPt{X: f})
				e.bulges = append(e.bulges, 0)
				vertIdx = len(e.pts) - 1
			} else {
				e.center = cadPt{X: f, Y: e.center.Y}
				if e.kind != "CIRCLE" && e.kind != "ARC" && e.kind != "ELLIPSE" {
					e.pts = ensurePt(e.pts, 0)
					e.pts[0].X = f
				}
			}
		case 20:
			if e.kind == "LWPOLYLINE" && vertIdx >= 0 {
				e.pts[vertIdx].Y = f
			} else if e.kind == "CIRCLE" || e.kind == "ARC" || e.kind == "ELLIPSE" {
				e.center.Y = f
			} else if len(e.pts) > 0 {
				e.pts[0].Y = f
			}
		case 11:
			if e.kind == "LINE" || e.kind == "SOLID" || e.kind == "3DFACE" || e.kind == "TRACE" {
				e.pts = ensurePt(e.pts, 1)
				e.pts[1].X = f
			} else if e.kind == "ELLIPSE" {
				e.major.X = f
			}
		case 21:
			if e.kind == "LINE" || e.kind == "SOLID" || e.kind == "3DFACE" || e.kind == "TRACE" {
				e.pts = ensurePt(e.pts, 1)
				e.pts[1].Y = f
			} else if e.kind == "ELLIPSE" {
				e.major.Y = f
			}
		case 12:
			if e.kind == "SOLID" || e.kind == "3DFACE" || e.kind == "TRACE" {
				e.pts = ensurePt(e.pts, 2)
				e.pts[2].X = f
			}
		case 22:
			if e.kind == "SOLID" || e.kind == "3DFACE" || e.kind == "TRACE" {
				e.pts = ensurePt(e.pts, 2)
				e.pts[2].Y = f
			}
		case 13:
			if e.kind == "SOLID" || e.kind == "3DFACE" || e.kind == "TRACE" {
				e.pts = ensurePt(e.pts, 3)
				e.pts[3].X = f
			}
		case 23:
			if e.kind == "SOLID" || e.kind == "3DFACE" || e.kind == "TRACE" {
				e.pts = ensurePt(e.pts, 3)
				e.pts[3].Y = f
			}
		case 40:
			if e.kind == "TEXT" || e.kind == "MTEXT" || e.kind == "ATTDEF" || e.kind == "ATTRIB" {
				e.height = f
			} else if e.kind == "CIRCLE" || e.kind == "ARC" {
				e.radius = f
			} else if e.kind == "ELLIPSE" {
				e.ratio = f
			} else {
				e.radius = f // 兜底：视作尺寸
			}
		case 41:
			if e.kind == "ELLIPSE" {
				e.p1 = f
				e.hasParam = true
			} else if e.kind == "INSERT" {
				e.scaleX = f
			}
		case 42:
			if e.kind == "LWPOLYLINE" && vertIdx >= 0 {
				e.bulges[vertIdx] = f
			} else if e.kind == "ELLIPSE" {
				e.p2 = f
			} else if e.kind == "INSERT" {
				e.scaleY = f
			}
		case 43:
			if e.kind == "INSERT" {
				e.scaleY = f
			}
		case 50:
			if e.kind == "TEXT" || e.kind == "MTEXT" || e.kind == "ATTDEF" || e.kind == "ATTRIB" ||
				e.kind == "INSERT" {
				e.rotation = f
			} else if e.kind == "ARC" {
				e.a1 = f
			}
		case 51:
			if e.kind == "ARC" {
				e.a2 = f
			}
		case 2:
			if e.kind == "INSERT" {
				e.block = t.Value
			}
		case 1:
			if e.kind == "TEXT" || e.kind == "MTEXT" || e.kind == "ATTDEF" || e.kind == "ATTRIB" {
				e.text += t.Value
			}
		case 3:
			if e.kind == "MTEXT" {
				e.text += t.Value
			}
		}
	}
	p.i = end - 1
}

// consumeVertex 收集 POLYLINE 的 VERTEX 子实体（紧随其后、直到 SEQEND）。
func (p *dxfParser) consumeVertex() {
	if p.polyline == nil {
		return
	}
	end := p.i + 1
	for end < len(p.tags) && p.tags[end].Code != 0 {
		end++
	}
	vx, vy, bulge := 0.0, 0.0, 0.0
	for j := p.i + 1; j < end; j++ {
		f, _ := parseDxfFloat(p.tags[j].Value)
		switch p.tags[j].Code {
		case 10:
			vx = f
		case 20:
			vy = f
		case 42:
			bulge = f
		}
	}
	p.polyline.pts = append(p.polyline.pts, cadPt{X: vx, Y: vy})
	p.polyline.bulges = append(p.polyline.bulges, bulge)
	p.i = end - 1
}

func (p *dxfParser) endPolyline() {
	if p.polyline == nil {
		return
	}
	// 实体在 newEntity 时已登记进 entities / blocks，此处不能重复追加；
	// 顶点不足 2 个的退化多段线由 emit 阶段自然跳过。
	p.polyline = nil
}

// ---------- 块展开与离散化 ----------

// emit 把实体写入图元集合；INSERT 会递归展开块定义并施加变换。
func (p *dxfParser) emit(ents []dxfEntity, offset cadPt, scale [2]float64, rot float64, depth int, d *cadDrawing) {
	if depth > 8 {
		return // 递防畸形文件的自引用块
	}
	for idx := range ents {
		e := &ents[idx]
		switch e.kind {
		case "INSERT":
			p.emitInsert(e, offset, scale, rot, depth, d)
		case "LINE":
			if len(e.pts) >= 2 {
				// 必须走 transformPts：INSERT 展开依赖它施加平移/缩放/旋转
				addPolyline(d, transformPts(e.pts[:2], offset, scale, rot), false, e, p)
			}
		case "LWPOLYLINE", "POLYLINE":
			pts := expandBulges(e.pts, e.bulges, e.closed)
			pts = transformPts(pts, offset, scale, rot)
			addPolyline(d, pts, e.closed, e, p)
		case "CIRCLE":
			pts := arcPts(e.center, e.radius, 0, 360)
			addPolyline(d, transformPts(pts, offset, scale, rot), true, e, p)
		case "ARC":
			pts := arcPts(e.center, e.radius, e.a1, e.a2)
			addPolyline(d, transformPts(pts, offset, scale, rot), false, e, p)
		case "ELLIPSE":
			pts := ellipsePts(e.center, e.major, e.ratio, e.p1, e.p2)
			addPolyline(d, transformPts(pts, offset, scale, rot), false, e, p)
		case "SPLINE":
			// 不做完整 NURBS 求值：控制点折线足以表达预览轮廓
			if len(e.pts) >= 2 {
				addPolyline(d, transformPts(e.pts, offset, scale, rot), false, e, p)
			}
		case "LEADER":
			if len(e.pts) >= 2 {
				addPolyline(d, transformPts(e.pts, offset, scale, rot), false, e, p)
			}
		case "SOLID", "TRACE", "3DFACE":
			if len(e.pts) >= 3 {
				pts := append([]cadPt(nil), e.pts...)
				pts = append(pts, e.pts[0])
				addPolyline(d, transformPts(pts, offset, scale, rot), true, e, p)
			}
		case "POINT":
			// 以极小十字表示，避免在预览里完全丢失
			c := e.center
			if len(e.pts) > 0 {
				c = e.pts[0]
			}
			r := 0.6
			s := transformPts([]cadPt{{c.X - r, c.Y}, {c.X + r, c.Y}}, offset, scale, rot)
			addPolyline(d, s, false, e, p)
			s2 := transformPts([]cadPt{{c.X, c.Y - r}, {c.X, c.Y + r}}, offset, scale, rot)
			addPolyline(d, s2, false, e, p)
		case "TEXT", "MTEXT", "ATTDEF", "ATTRIB":
			txt := cleanDXFText(e.text)
			if strings.TrimSpace(txt) == "" {
				continue
			}
			pos := e.center
			if len(e.pts) > 0 {
				pos = e.pts[0]
			}
			pos = transformPt(pos, offset, scale, rot)
			h := e.height
			if h <= 0 {
				h = 2.5
			}
			h *= math.Abs(scale[1])
			if len(e.pts) > 0 {
				h *= 1 // 保持与坐标缩放一致
			}
			d.Texts = append(d.Texts, cadText{
				Pos:      pos,
				Content:  txt,
				Height:   h,
				Rotation: e.rotation + rot,
				Color:    p.colorOf(e),
			})
		case "DIMENSION":
			// 尺寸标注的可见几何在其匿名块里，通过 code 2 引用
			if e.block != "" {
				if sub, ok := p.blocks[e.block]; ok {
					base := p.blockBase[e.block]
					p.emit(sub, cadPt{X: offset.X - base.X*scale[0], Y: offset.Y - base.Y*scale[1]}, scale, rot, depth+1, d)
				}
			}
		}
	}
}

func (p *dxfParser) emitInsert(e *dxfEntity, offset cadPt, scale [2]float64, rot float64, depth int, d *cadDrawing) {
	sub, ok := p.blocks[e.block]
	if !ok || len(sub) == 0 {
		return
	}
	base := p.blockBase[e.block]
	sx, sy := e.scaleX, e.scaleY
	if sx == 0 || sy == 0 {
		sx, sy = 1, 1
	}
	ins := e.center
	if len(e.pts) > 0 {
		ins = e.pts[0]
	}
	total := [2]float64{scale[0] * sx, scale[1] * sy}
	// 块内坐标先平移到块基点，再旋转、缩放，最后落到插入点（叠加外层变换）。
	inner := make([]dxfEntity, len(sub))
	copy(inner, sub)
	shifted := make([]dxfEntity, 0, len(inner))
	for i := range inner {
		inner[i].pts = shiftedPts(inner[i].pts, -base.X, -base.Y)
		if inner[i].kind == "CIRCLE" || inner[i].kind == "ARC" || inner[i].kind == "ELLIPSE" {
			inner[i].center = cadPt{X: inner[i].center.X - base.X, Y: inner[i].center.Y - base.Y}
		}
		inner[i].rotation += e.rotation
		shifted = append(shifted, inner[i])
	}
	totalRot := rot + e.rotation
	// 先把插入点变换到当前坐标系
	insT := transformPt(ins, offset, [2]float64{1, 1}, rot)
	p.emit(shifted, insT, total, totalRot, depth+1, d)
}

func (p *dxfParser) colorOf(e *dxfEntity) string {
	aci := e.color
	if aci == 0 || aci == 256 { // ByBlock / ByLayer
		if c, ok := p.layerCol[e.layer]; ok && c > 0 && c < 256 {
			aci = c
		} else {
			aci = 7
		}
	}
	if aci < 0 { // 真彩色（420）
		v := uint32(-aci)
		return fmt.Sprintf("#%02x%02x%02x", (v>>16)&0xff, (v>>8)&0xff, v&0xff)
	}
	return aciHex(aci)
}

// computeBounds 按实际图元计算包围盒。
func (d *cadDrawing) computeBounds() {
	first := true
	upd := func(pt cadPt) {
		if first {
			d.Min, d.Max, first = pt, pt, false
			return
		}
		if pt.X < d.Min.X {
			d.Min.X = pt.X
		}
		if pt.Y < d.Min.Y {
			d.Min.Y = pt.Y
		}
		if pt.X > d.Max.X {
			d.Max.X = pt.X
		}
		if pt.Y > d.Max.Y {
			d.Max.Y = pt.Y
		}
	}
	for _, pl := range d.Polylines {
		for _, pt := range pl.Pts {
			upd(pt)
		}
	}
	for _, t := range d.Texts {
		upd(t.Pos)
		upd(cadPt{X: t.Pos.X + t.Height*float64(len([]rune(t.Content)))*0.6, Y: t.Pos.Y + t.Height})
	}
}

// ---------- 曲线离散化 ----------

// arcSegments 按半径自适应决定圆弧细分段数（半径越大越细，上限 256 段）。
func arcSegments(radius float64) int {
	n := int(radius * 0.6)
	if n < 16 {
		n = 16
	}
	if n > 256 {
		n = 256
	}
	return n
}

// arcPts 生成圆弧折线（角度制，逆时针，自动处理跨 0 度）。
func arcPts(c cadPt, r, a1, a2 float64) []cadPt {
	if r <= 0 {
		return nil
	}
	for a2 < a1 {
		a2 += 360
	}
	if a2-a1 >= 359.999 {
		// 整圆
		n := arcSegments(r)
		out := make([]cadPt, 0, n)
		for i := 0; i < n; i++ {
			th := 2 * math.Pi * float64(i) / float64(n)
			out = append(out, cadPt{X: c.X + r*math.Cos(th), Y: c.Y + r*math.Sin(th)})
		}
		return out
	}
	span := a2 - a1
	n := int(float64(arcSegments(r)) * span / 360.0)
	if n < 4 {
		n = 4
	}
	out := make([]cadPt, 0, n+1)
	for i := 0; i <= n; i++ {
		th := (a1 + span*float64(i)/float64(n)) * math.Pi / 180
		out = append(out, cadPt{X: c.X + r*math.Cos(th), Y: c.Y + r*math.Sin(th)})
	}
	return out
}

// ellipsePts 生成椭圆（或椭圆弧）折线。
func ellipsePts(c, major cadPt, ratio, p1, p2 float64) []cadPt {
	if ratio <= 0 {
		ratio = 1
	}
	majorR := math.Hypot(major.X, major.Y)
	if majorR <= 0 {
		return nil
	}
	minorR := majorR * ratio
	rot := math.Atan2(major.Y, major.X)
	full := !(p2 > p1 && p2-p1 < 2*math.Pi-1e-6)
	if p2 <= p1 {
		p1, p2 = 0, 2*math.Pi
	}
	n := arcSegments(math.Max(majorR, minorR))
	out := make([]cadPt, 0, n+1)
	for i := 0; i <= n; i++ {
		th := p1 + (p2-p1)*float64(i)/float64(n)
		x := majorR * math.Cos(th)
		y := minorR * math.Sin(th)
		out = append(out, cadPt{
			X: c.X + x*math.Cos(rot) - y*math.Sin(rot),
			Y: c.Y + x*math.Sin(rot) + y*math.Cos(rot),
		})
	}
	if full {
		out = out[:len(out)-1]
	}
	return out
}

// expandBulges 把多段线的凸度段展开成折线点。
// bulge = tan(包含角/4)，正值表示逆时针。
func expandBulges(pts []cadPt, bulges []float64, closed bool) []cadPt {
	if len(pts) == 0 {
		return nil
	}
	hasBulge := false
	for _, b := range bulges {
		if b != 0 {
			hasBulge = true
			break
		}
	}
	if !hasBulge {
		out := append([]cadPt(nil), pts...)
		if closed && len(out) > 1 {
			out = append(out, out[0])
		}
		return out
	}
	out := make([]cadPt, 0, len(pts)*4)
	for i := 0; i < len(pts); i++ {
		out = append(out, pts[i])
		next := i + 1
		if next >= len(pts) {
			if !closed {
				break
			}
			next = 0
		}
		var b float64
		if i < len(bulges) {
			b = bulges[i]
		}
		if b == 0 {
			continue
		}
		arc := bulgeArcPts(pts[i], pts[next], b)
		if len(arc) > 2 {
			// 去掉首尾（已由 pts[i] 与本段终点覆盖）
			out = append(out, arc[1:len(arc)-1]...)
		}
	}
	if closed && len(out) > 0 {
		out = append(out, out[0])
	}
	return out
}

// bulgeArcPts 由凸度计算两点间的圆弧采样点。
func bulgeArcPts(p0, p1 cadPt, bulge float64) []cadPt {
	theta := 4 * math.Atan(bulge) // 包含角（弧度，带符号）
	if math.Abs(theta) < 1e-9 {
		return []cadPt{p0, p1}
	}
	chord := math.Hypot(p1.X-p0.X, p1.Y-p0.Y)
	if chord == 0 {
		return []cadPt{p0, p1}
	}
	// 由弦长与包含角求半径；再求圆心
	r := chord / (2 * math.Sin(math.Abs(theta)/2))
	mid := cadPt{X: (p0.X + p1.X) / 2, Y: (p0.Y + p1.Y) / 2}
	// 圆心到弦的垂距
	h := math.Sqrt(math.Max(0, r*r-chord*chord/4))
	ang := math.Atan2(p1.Y-p0.Y, p1.X-p0.X)
	// 包含角符号决定圆心在弦的哪一侧
	sign := 1.0
	if theta < 0 {
		sign = -1
	}
	if math.Abs(theta) > math.Pi {
		h = -h
	}
	nx := mid.X - h*math.Sin(ang)*sign
	ny := mid.Y + h*math.Cos(ang)*sign
	c := cadPt{X: nx, Y: ny}

	a0 := math.Atan2(p0.Y-c.Y, p0.X-c.X)
	a1 := a0 + theta
	n := int(math.Max(6, math.Abs(theta)*float64(arcSegments(r))/(2*math.Pi)))
	out := make([]cadPt, 0, n+1)
	for i := 0; i <= n; i++ {
		th := a0 + (a1-a0)*float64(i)/float64(n)
		out = append(out, cadPt{X: c.X + r*math.Cos(th), Y: c.Y + r*math.Sin(th)})
	}
	return out
}

// ---------- 变换与工具 ----------

func transformPt(p cadPt, offset cadPt, scale [2]float64, rot float64) cadPt {
	x, y := p.X*scale[0], p.Y*scale[1]
	if rot != 0 {
		rad := rot * math.Pi / 180
		x, y = x*math.Cos(rad)-y*math.Sin(rad), x*math.Sin(rad)+y*math.Cos(rad)
	}
	return cadPt{X: x + offset.X, Y: y + offset.Y}
}

func transformPts(pts []cadPt, offset cadPt, scale [2]float64, rot float64) []cadPt {
	if len(pts) == 0 {
		return nil
	}
	out := make([]cadPt, len(pts))
	for i, p := range pts {
		out[i] = transformPt(p, offset, scale, rot)
	}
	return out
}

func shiftedPts(pts []cadPt, dx, dy float64) []cadPt {
	if len(pts) == 0 {
		return pts
	}
	out := make([]cadPt, len(pts))
	for i, p := range pts {
		out[i] = cadPt{X: p.X + dx, Y: p.Y + dy}
	}
	return out
}

func addPolyline(d *cadDrawing, pts []cadPt, closed bool, e *dxfEntity, p *dxfParser) {
	if len(pts) < 2 {
		return
	}
	d.Polylines = append(d.Polylines, cadPolyline{
		Pts:    pts,
		Closed: closed,
		Color:  p.colorOf(e),
	})
}

func ensurePt(pts []cadPt, i int) []cadPt {
	for len(pts) <= i {
		pts = append(pts, cadPt{})
	}
	return pts
}

func hasFlag(v, bit int) bool { return v&bit != 0 }

func parseDxfFloat(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// cleanDXFText 去掉 MTEXT 的内联格式码（\P 换行、\f...; 字体、{} 分组等）。
func cleanDXFText(s string) string {
	if s == "" {
		return ""
	}
	var b strings.Builder
	for i := 0; i < len(s); {
		c := s[i]
		switch {
		case c == '\\' && i+1 < len(s):
			n := s[i+1]
			switch n {
			case 'P', 'p':
				b.WriteByte(' ')
				i += 2
			case 'f', 'F', 'H', 'C', 'c', 'T', 'Q', 'W', 'A', 'S':
				// 参数直到分号
				j := strings.IndexByte(s[i:], ';')
				if j < 0 {
					i += 2
				} else {
					i += j + 1
				}
			case '\\', '{', '}':
				b.WriteByte(n)
				i += 2
			case 'L', 'l', 'O', 'o', 'K', 'k':
				i += 2
			default:
				i += 2
			}
		case c == '{' || c == '}':
			i++
		case c == '^' && i+1 < len(s):
			// ^I 等控制码
			i += 2
		default:
			b.WriteByte(c)
			i++
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}
