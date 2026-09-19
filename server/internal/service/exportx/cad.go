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

// 文字盒度量模型（近似值）。折行宽度、包围盒与锚点换算全部共用这一组常量，
// 保证「算出来的盒」与「画出来的字」是同一个盒。
//
// ascent 0.8 / descent 0.2 使「字面盒高 = 字高」，与 AutoCAD 的字高定义相符
// （西文大写高度约 0.7 字高；把汉字全角框一并计入后约 0.8/0.2）。
// 行距 1.2 倍是 AutoCAD 单倍行距的常用近似 —— MTEXT 的真实行距由组码 44/45 给出，
// 这里不解析：它对整体观感的影响远小于字高本身。
const (
	cadAscent      = 0.8
	cadDescent     = 0.2
	cadLineAdvance = 1.2
	// cadCharWidthRatio 平均字宽 / 字高。0.62 是西文字符的典型值，
	// 汉字为全角（1.0）会被略微低估 —— 宁可估窄不过估宽：
	// 估宽会把文字包围盒放大、进而把整幅图挤小。
	cadCharWidthRatio = 0.62
)

// cadText 一段文字（可能多行）。
type cadText struct {
	Pos      cadPt
	Content  string  // 可能含 \n：MTEXT 的 \P 分段 / 按参考宽度折行后的结果
	Height   float64 // 字高（世界单位）；<=0 表示待兜底（见 resolveTextHeights）
	Rotation float64 // 度，逆时针
	Color    string
	AnchorH  int     // 水平锚点 0=左 1=中 2=右
	AnchorV  int     // 垂直锚点 0=基线 1=底 2=中 3=顶
	// WidthFactor 字宽因子（STYLE 组码 41 / TEXT 组码 41），<=0 视为 1。
	WidthFactor float64
	// blockScale 该文字所在块参照链上的累积 Y 缩放。
	// 仅在 Height<=0 时被 resolveTextHeights 使用：兜底字高是世界单位，
	// 必须再乘块缩放才是最终设备字高。Height>0 时 emit 阶段已乘过，此字段无意义。
	blockScale float64
}

// cadTextBox 文字的排版盒（坐标系与传入的 Height 一致）。
// 位置以 Pos 为原点：LeftX/TopY 是盒左上角相对 Pos 的偏移（DXF 坐标，Y 向上）。
type cadTextBox struct {
	LeftX, TopY          float64
	Width, Height        float64
	LineAdvance          float64
	FirstBaselineFromTop float64
}

// textBox 按锚点计算排版盒。
//
// 垂直锚点统一按「整个文字盒」解释：对单行（TEXT）它就退化为该行自身的盒，
// 对多行（MTEXT）则对应附着点的顶/中/底语义。这样两种实体共用一套换算，
// 不会出现「TEXT 算对了、MTEXT 差一行」的偏差。
func textBox(t cadText) cadTextBox {
	h := t.Height
	if h <= 0 {
		h = 1e-6
	}
	wf := t.WidthFactor
	if wf <= 0 {
		wf = 1
	}
	lines := strings.Split(t.Content, "\n")
	if len(lines) == 0 {
		lines = []string{""}
	}
	maxRunes := 0
	for _, ln := range lines {
		if n := len([]rune(ln)); n > maxRunes {
			maxRunes = n
		}
	}
	adv := cadLineAdvance * h
	width := h * wf * float64(maxRunes) * cadCharWidthRatio
	boxH := h + float64(len(lines)-1)*adv

	var top float64
	switch t.AnchorV {
	case 1: // 底：Pos.Y 位于盒底
		top = boxH
	case 2: // 中：Pos.Y 位于盒中
		top = boxH / 2
	case 3: // 顶：Pos.Y 位于盒顶
		top = 0
	default: // 基线：Pos.Y 是首行基线
		top = cadAscent * h
	}
	var left float64
	switch t.AnchorH {
	case 1:
		left = -width / 2
	case 2:
		left = -width
	}
	return cadTextBox{
		LeftX: left, TopY: top,
		Width: width, Height: boxH,
		LineAdvance:          adv,
		FirstBaselineFromTop: cadAscent * h,
	}
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

	// 文字排版相关（TEXT/MTEXT/ATTRIB/ATTDEF）
	style       string  // 组码 7：文字样式名；固定字高与宽度因子挂在 STYLE 表上
	widthFactor float64 // TEXT 组码 41：相对 X 缩放（字宽因子，1=正常）
	mtWidth     float64 // MTEXT 组码 41：参考矩形宽度（折行宽度，世界单位）
	attach      int     // MTEXT 组码 71：附着点 1..9（1=左上 … 9=右下）
	justH       int     // TEXT 组码 72：水平对齐 0=左 1=中 2=右
	justV       int     // TEXT 组码 73：垂直对齐 0=基线 1=底 2=中 3=顶
	alignPt     cadPt   // TEXT 组码 11/21：对齐点（justH/justV 非 0 时才是真插入点）
	hasAlign    bool
	dirVec      cadPt // MTEXT 组码 11/21：文字 X 轴方向向量（用于反推旋转）
	hasDirVec   bool

	block                  string
	scaleX, scaleY, scaleZ float64

	color int // ACI 索引；0=ByBlock，256=ByLayer
	layer string
}

// cadTextStyle STYLE 表的一条记录。
type cadTextStyle struct {
	Height float64 // 组码 40：固定字高；0 = 不固定，由实体自身指定
	Width  float64 // 组码 41：宽度因子
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
		styles:    map[string]cadTextStyle{},
	}
	if err := p.run(); err != nil {
		return nil, err
	}

	d := &cadDrawing{Units: p.insUnits}
	p.emit(p.entities, cadPt{}, [2]float64{1, 1}, 0, 0, d)

	// 字高兜底必须排在包围盒之前：兜底值依赖图幅尺度（见 fallbackTextHeight）。
	p.resolveTextHeights(d)

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
	styles    map[string]cadTextStyle

	insUnits   int
	textSize   float64 // HEADER $TEXTSIZE
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
	case "$TEXTSIZE":
		// 图形声明的默认字高（世界单位）。它是文件自带的尺度信息，
		// 比任何写死的常量都可靠，故作为字高兜底链上的一环。
		p.textSize = p.peekFloat(40)
	}
}

func (p *dxfParser) tableTag(t dxfTag) {
	switch strings.ToUpper(t.Value) {
	case "LAYER":
		name := p.peekValue(2)
		if name != "" {
			p.layerCol[name] = int(p.peekFloat(62))
		}
	case "STYLE":
		// STYLE 表：文字样式可以固定字高（组码 40≠0）。此时实体的组码 40 为 0，
		// 字高只能从样式取 —— 正是历史实现拿不到字高、回落到写死常量 2.5 的场景。
		name := p.peekValue(2)
		if name != "" {
			p.styles[name] = cadTextStyle{Height: p.peekFloat(40), Width: p.peekFloat(41)}
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
	e := dxfEntity{kind: kind, scaleX: 1, scaleY: 1, scaleZ: 1, ratio: 1, widthFactor: 1}
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
			} else if e.kind == "TEXT" || e.kind == "ATTDEF" || e.kind == "ATTRIB" {
				e.alignPt.X = f
				e.hasAlign = true
			} else if e.kind == "MTEXT" {
				e.dirVec.X = f
				e.hasDirVec = true
			}
		case 21:
			if e.kind == "LINE" || e.kind == "SOLID" || e.kind == "3DFACE" || e.kind == "TRACE" {
				e.pts = ensurePt(e.pts, 1)
				e.pts[1].Y = f
			} else if e.kind == "ELLIPSE" {
				e.major.Y = f
			} else if e.kind == "TEXT" || e.kind == "ATTDEF" || e.kind == "ATTRIB" {
				e.alignPt.Y = f
				e.hasAlign = true
			} else if e.kind == "MTEXT" {
				e.dirVec.Y = f
				e.hasDirVec = true
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
			switch e.kind {
			case "ELLIPSE":
				e.p1 = f
				e.hasParam = true
			case "INSERT":
				e.scaleX = f
			case "MTEXT":
				// MTEXT 的 41 是「参考矩形宽度」（折行宽度），**不是**字宽因子
				e.mtWidth = f
			case "TEXT", "ATTDEF", "ATTRIB":
				e.widthFactor = f
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
			// DXF 中 INSERT 的组码 43 是 **scaleZ**。
			// 历史实现写成 e.scaleY = f，把已由组码 42 读到的 Y 缩放覆盖掉，
			// 于是凡是 Z 缩放 ≠ 1 的块参照，块内文字与几何都会被整体拉扁/拉长。
			if e.kind == "INSERT" {
				e.scaleZ = f
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
			// INSERT 是块参照；DIMENSION 的可见几何同样装在一个匿名块里
			// （*D1 / *D2 之类），也靠组码 2 引用它。
			// 历史实现只认 INSERT，于是**所有尺寸标注被静默丢弃** ——
			// emit 里的 DIMENSION 分支因此是一段永远进不去的死代码。
			if e.kind == "INSERT" || e.kind == "DIMENSION" {
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
		case 7:
			if isTextKind(e.kind) {
				e.style = t.Value
			}
		case 71:
			// MTEXT 附着点（1..9）。缺了它，多行注释会以「左上」以外的位置为基准落点，
			// 常常整块偏出一行/一列，和其它标注重叠。
			if e.kind == "MTEXT" {
				e.attach = int(f)
			}
		case 72:
			if e.kind == "TEXT" || e.kind == "ATTDEF" || e.kind == "ATTRIB" {
				e.justH = int(f)
			}
		case 73:
			if e.kind == "TEXT" || e.kind == "ATTDEF" || e.kind == "ATTRIB" {
				e.justV = int(f)
			}
		}
	}
	p.i = end - 1
}

// isTextKind 是否为携带字高/样式/对齐属性的文字类实体。
func isTextKind(kind string) bool {
	switch kind {
	case "TEXT", "MTEXT", "ATTDEF", "ATTRIB":
		return true
	}
	return false
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
			// TEXT：组码 72/73 任一非 0 时，真正的落点是 11/21（对齐点），
			// 10/20 只是名义插入点。忽略这点会把居中/右对齐的标注整体平移，
			// 与相邻文字挤在一起。
			if e.kind != "MTEXT" && (e.justH != 0 || e.justV != 0) && e.hasAlign {
				pos = e.alignPt
			}
			pos = transformPt(pos, offset, scale, rot)

			// 字高：实体 → 样式固定字高 → $TEXTSIZE；都拿不到就留 0 待兜底。
			// ⚠️ 历史实现在这里是 `h = 2.5`（写死的**世界单位**常量）。
			// 字高脱离图幅尺度没有意义：米制图幅（图幅几十个单位）下 2.5 会折算成
			// 上百像素的字，文字直接铺满整张图 —— 这是「字体太大、糊成一片」的主因。
			h := p.textHeightOf(e)
			if h > 0 {
				h *= math.Abs(scale[1])
			}
			wf := p.widthFactorOf(e)

			// MTEXT 的水平方向由「X 轴方向向量」（11/21）给出，组码 50 常为 0。
			// 纵向排版（方向 3）不在此处倒推，仍按水平处理。
			rev := e.rotation
			if e.kind == "MTEXT" && e.hasDirVec && (e.dirVec.X != 0 || e.dirVec.Y != 0) {
				rev = math.Atan2(e.dirVec.Y, e.dirVec.X) * 180 / math.Pi
			}

			lines := strings.Split(txt, "\n")
			if e.kind == "MTEXT" && e.mtWidth > 0 {
				lines = wrapCadText(lines, e.mtWidth*math.Abs(scale[0]), h, wf)
			}
			ah, av := e.justH, e.justV
			if e.kind == "MTEXT" {
				ah, av = mtextAnchor(e.attach)
			}
			d.Texts = append(d.Texts, cadText{
				Pos:         pos,
				Content:     strings.Join(lines, "\n"),
				Height:      h, // 可能为 0：交由 resolveTextHeights 按图幅兜底
				Rotation:    rev + rot,
				Color:       p.colorOf(e),
				AnchorH:     clampInt(ah, 0, 2),
				AnchorV:     clampInt(av, 0, 3),
				WidthFactor: wf,
				blockScale:  math.Abs(scale[1]),
			})
		case "DIMENSION":
			// 尺寸标注的可见几何在其匿名块里，通过组码 2 引用
			// （组码 2 的解析已同时覆盖 INSERT 与 DIMENSION，见 fillCommon）。
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
	// 插入点是**当前坐标系里的点**，必须按当前累积缩放 scale 变换后再叠加外层位移。
	// 历史实现这里写死 [1,1]（只平移+旋转、丢掉缩放），于是嵌套块参照
	// （块里再插块，标注块/图框图/标准件库常见）整体错位，
	// 错位量与外层缩放系数成正比 —— 图元彼此错位叠在一起就是一片糊。
	insT := transformPt(ins, offset, scale, rot)
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
		// 复用与渲染完全相同的那一份 textBox，避免「包围盒按一处估、字按另一处画」
		// 导致文字被裁在画布外。旋转文字仍按未旋转的盒计入（近似）——
		// CAD 图里旋转标注占比很低，为它引入完整的方向包围盒不划算。
		tb := textBox(t)
		left := t.Pos.X + tb.LeftX
		top := t.Pos.Y + tb.TopY
		upd(cadPt{X: left, Y: top})
		upd(cadPt{X: left + tb.Width, Y: top - tb.Height})
	}
}

// ---------- 文字字高兜底 ----------

// resolveTextHeights 为「实体与样式都没给出字高」的文字兜一个与图幅相关的字高。
//
// 为什么必须相对图幅：字高是世界单位，脱离图幅尺度就没有意义。历史实现用写死的
// 2.5（世界单位）兜底 —— 在米制图幅（整体只有几十个单位）或小尺寸零件图下，
// 2.5 折算到设备像素会有上百像素高，文字直接铺满并盖住整张图。
func (p *dxfParser) resolveTextHeights(d *cadDrawing) {
	pending := false
	for i := range d.Texts {
		if d.Texts[i].Height <= 0 {
			pending = true
			break
		}
	}
	if !pending {
		return
	}
	h := p.fallbackTextHeight(d)
	for i := range d.Texts {
		if d.Texts[i].Height > 0 {
			continue
		}
		s := d.Texts[i].blockScale
		if s <= 0 {
			s = 1
		}
		d.Texts[i].Height = h * s
	}
}

// fallbackTextHeight 兜底字高 = 图幅短边的 1/60。
// 参照：A1（841×594mm）上 10mm 高的注记约为短边的 1/60，是常见的小号标注尺度。
func (p *dxfParser) fallbackTextHeight(d *cadDrawing) float64 {
	w, h := p.extentForTextFallback(d)
	short := math.Min(w, h)
	if short <= 0 {
		short = math.Max(w, h)
	}
	if short <= 0 {
		return 1
	}
	return short / 60
}

// extentForTextFallback 估算图幅：优先 HEADER 的 $EXTMIN/$EXTMAX；
// 否则只用**折线**范围。
//
// 刻意不含文字：若把文字自身算进去就会形成正反馈
// （兜底字高变大 → 文字包围盒变大 → 图幅变大 → 兜底字高再变大）。
func (p *dxfParser) extentForTextFallback(d *cadDrawing) (float64, float64) {
	if p.hasExtents && p.extMax.X > p.extMin.X && p.extMax.Y > p.extMin.Y {
		return p.extMax.X - p.extMin.X, p.extMax.Y - p.extMin.Y
	}
	var minPt, maxPt cadPt
	first := true
	for _, pl := range d.Polylines {
		for _, pt := range pl.Pts {
			if first {
				minPt, maxPt, first = pt, pt, false
				continue
			}
			minPt.X, minPt.Y = math.Min(minPt.X, pt.X), math.Min(minPt.Y, pt.Y)
			maxPt.X, maxPt.Y = math.Max(maxPt.X, pt.X), math.Max(maxPt.Y, pt.Y)
		}
	}
	if first {
		return 0, 0
	}
	return maxPt.X - minPt.X, maxPt.Y - minPt.Y
}

// wrapCadText 按参考宽度把 MTEXT 折行（宽度与字高须同处一个坐标系）。
// 字宽按「字高 × 字宽因子 × cadCharWidthRatio」估算，与 textBox 同源，
// 让「折行后不越界」和「包围盒不虚大」两个结论彼此一致。
func wrapCadText(lines []string, width, height, widthFactor float64) []string {
	per := height * widthFactor * cadCharWidthRatio
	if per <= 0 || width <= 0 {
		return lines
	}
	max := int(width / per)
	if max < 1 {
		max = 1
	}
	out := make([]string, 0, len(lines))
	for _, ln := range lines {
		runes := []rune(ln)
		if len(runes) <= max {
			out = append(out, ln)
			continue
		}
		for len(runes) > max {
			out = append(out, strings.TrimRight(string(runes[:max]), " "))
			runes = runes[max:]
		}
		out = append(out, string(runes))
	}
	if len(out) == 0 {
		return lines
	}
	return out
}

// mtextAnchor 把 MTEXT 附着点（组码 71，1..9）归一化为
// 水平 0=左/1=中/2=右、垂直 0=基线/1=底/2=中/3=顶。
// 1..3 为顶行、4..6 为中行、7..9 为底行，每行内依次是 左/中/右。
// MTEXT 没有「基线」锚点，故本函数不会返回 0。
func mtextAnchor(attach int) (int, int) {
	if attach < 1 || attach > 9 {
		attach = 1 // DXF 缺省附着点为左上
	}
	row := (attach - 1) / 3 // 0=顶 1=中 2=底
	col := (attach - 1) % 3 // 0=左 1=中 2=右
	switch row {
	case 1:
		return col, 2
	case 2:
		return col, 1
	default:
		return col, 3
	}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// textHeightOf 解析实体字高，按可靠性依次取：
//  1. 实体自身组码 40；
//  2. 其文字样式的固定字高（STYLE 组码 40）；
//  3. 图形声明的 $TEXTSIZE。
//
// 都拿不到时返回 0，交由 resolveTextHeights 按图幅兜底。
func (p *dxfParser) textHeightOf(e *dxfEntity) float64 {
	if e.height > 0 {
		return e.height
	}
	if st, ok := p.styles[e.style]; ok && st.Height > 0 {
		return st.Height
	}
	if p.textSize > 0 {
		return p.textSize
	}
	return 0
}

// widthFactorOf 字宽因子：实体组码 41 → 样式组码 41 → 1。
func (p *dxfParser) widthFactorOf(e *dxfEntity) float64 {
	if e.widthFactor > 0 {
		return e.widthFactor
	}
	if st, ok := p.styles[e.style]; ok && st.Width > 0 {
		return st.Width
	}
	return 1
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

// cleanDXFText 去掉 MTEXT 的内联格式码（\f...; 字体、{} 分组、^I 控制码等），
// 并把段落分隔 \P **保留为换行**。
//
// ⚠️ \P 必须保留换行。历史实现把它折成一个空格，于是「多行注释 / 说明文字」这种
// 在图纸里极其常见的 MTEXT 会被压成**一整行横贯图幅的长文本**，与相邻标注全部
// 重叠 —— 这正是用户看到的「糊成一片」的直接来源。
// 换行在渲染层按行绘制（见 cad_render.go），不改动图的几何。
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
				b.WriteByte('\n')
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
	// 逐行收敛空白：换行是排版信息，其余连续空白才该被压掉。
	lines := strings.Split(b.String(), "\n")
	for i, ln := range lines {
		lines[i] = strings.Join(strings.Fields(ln), " ")
	}
	return strings.Join(lines, "\n")
}
