# -*- coding: utf-8 -*-
"""PPT (.pptx) 生成引擎：标题页、分节页、要点页、双栏页、图片占位、数据页、时间轴、结尾页。"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN, MSO_AUTO_SIZE
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from docx.oxml import OxmlElement
from design import FONT_CN_HEAD, FONT_EN, theme, rgb


def _solid(shape, hexcolor):
    shape.fill.solid()
    shape.fill.fore_color.rgb = rgb(hexcolor)


def _no_line(shape):
    shape.line.fill.background()


def _line(shape, hexcolor, w=1.0):
    shape.line.color.rgb = rgb(hexcolor)
    shape.line.width = Pt(w)


def _gradient(shape, c1, c2, angle=90):
    # 直接构造 a:gradFill，兼容各版本 python-pptx
    spPr = shape.fill._xPr
    for tag in ('a:solidFill', 'a:noFill', 'a:gradFill', 'a:blipFill',
                'a:pattFill', 'a:grpFill'):
        old = spPr.find(qn(tag))
        if old is not None:
            spPr.remove(old)
    gf = OxmlElement('a:gradFill')
    gsl = OxmlElement('a:gsLst')
    gs1 = OxmlElement('a:gs'); gs1.set('pos', '0')
    c1e = OxmlElement('a:srgbClr'); c1e.set('val', c1); gs1.append(c1e)
    gs2 = OxmlElement('a:gs'); gs2.set('pos', '100000')
    c2e = OxmlElement('a:srgbClr'); c2e.set('val', c2); gs2.append(c2e)
    gsl.append(gs1); gsl.append(gs2)
    gf.append(gsl)
    lin = OxmlElement('a:lin'); lin.set('ang', str(int(angle * 60000))); lin.set('scaled', '1')
    gf.append(lin)
    spPr.append(gf)


def _text(slide, x, y, w, h, text, size=18, color="222222", bold=False,
          align="left", anchor="top", italic=False, font=FONT_CN_HEAD,
          line_spacing=1.15, en=False):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE,
                          "bottom": MSO_ANCHOR.BOTTOM}[anchor]
    tf.margin_left = Inches(0.05); tf.margin_right = Inches(0.05)
    tf.margin_top = Inches(0.02); tf.margin_bottom = Inches(0.02)
    p = tf.paragraphs[0]
    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                   "right": PP_ALIGN.RIGHT}[align]
    p.line_spacing = line_spacing
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = rgb(color)
    r.font.name = FONT_EN if en else font
    rpr = r._r.get_or_add_rPr()
    rfonts = rpr.find(qn('a:latin'))
    if rfonts is None:
        rfonts = rpr.makeelement(qn('a:latin'), {})
        rpr.append(rfonts)
    rfonts.set('typeface', FONT_EN if en else font)
    reast = rpr.find(qn('a:ea'))
    if reast is None:
        reast = rpr.makeelement(qn('a:ea'), {})
        rpr.append(reast)
    reast.set('typeface', FONT_CN_HEAD)
    return tb


def _rect(slide, x, y, w, h, fill=None, line=None, lw=1.0, shape=MSO_SHAPE.RECTANGLE):
    sp = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sp.fill.background()
    else:
        _solid(sp, fill)
    if line is None:
        _no_line(sp)
    else:
        _line(sp, line, lw)
    sp.shadow.inherit = False
    return sp


def new_presentation():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    return prs


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def _content_header(slide, th, title, kicker=None):
    _rect(slide, 0.7, 0.55, 0.16, 0.62, fill=th["gold"])
    _text(slide, 0.98, 0.5, 9.5, 0.7, title, size=26, color=th["primary"],
          bold=True, anchor="middle")
    if kicker:
        _text(slide, 0.99, 1.18, 9.5, 0.32, kicker, size=11, color=th["muted"],
              en=True)
    _rect(slide, 0.7, 1.32, 11.9, 0.03, fill=th["light"])


def _footer(slide, th, idx, brand):
    _rect(slide, 0.7, 7.05, 11.9, 0.018, fill=th["light"])
    _text(slide, 0.7, 7.1, 7.0, 0.3, brand, size=9, color=th["muted"], en=True)
    _text(slide, 11.0, 7.1, 1.6, 0.3, "%02d" % idx, size=9, color=th["muted"],
          align="right", en=True)


def add_title(prs, th, title, subtitle, brand, date="2026"):
    s = _blank(prs)
    _rect(s, 0, 0, 13.333, 7.5, fill=th["dark"])
    _gradient(s.shapes[-1], th["dark"], th["primary"], angle=60)
    # 装饰圆
    _rect(s, 10.6, -1.2, 3.6, 3.6, fill=th["accent"], shape=MSO_SHAPE.OVAL)
    s.shapes[-1].fill.fore_color.rgb = rgb(th["accent"])
    _set_alpha(s.shapes[-1], 28)
    _rect(s, 11.8, 4.6, 2.6, 2.6, fill=th["gold"], shape=MSO_SHAPE.OVAL)
    _set_alpha(s.shapes[-1], 22)
    _rect(s, 0.95, 2.35, 0.22, 1.7, fill=th["gold"])
    _text(s, 1.35, 2.3, 10.5, 1.8, title, size=46, color="FFFFFF", bold=True,
          anchor="middle")
    _text(s, 1.38, 4.15, 10.5, 0.7, subtitle, size=18, color="DCE6F1", en=True)
    _text(s, 1.35, 6.35, 10, 0.4, brand + "   |   " + date, size=12,
          color="AFC4DC", en=True)
    return s


def _set_alpha(shape, val):
    # 给填充色（仅图形）增加透明度（val 表示不透明度百分比，越小越透明）
    try:
        xfill = shape.fill.fore_color._xFill
    except Exception:
        return
    if xfill is None:
        return
    for clr in xfill.findall('.//' + qn('a:srgbClr')):
        a = clr.find(qn('a:alpha'))
        if a is None:
            a = clr.makeelement(qn('a:alpha'), {})
            clr.append(a)
        a.set('val', str(int((100 - val) * 1000)))


def lighten(hex_color, factor=0.4):
    # factor: 0=原色 1=白色
    r = int(hex_color[0:2], 16); g = int(hex_color[2:4], 16); b = int(hex_color[4:6], 16)
    r = int(r + (255 - r) * factor); g = int(g + (255 - g) * factor); b = int(b + (255 - b) * factor)
    return "%02X%02X%02X" % (r, g, b)


def add_section(prs, th, num, title, brand, idx):
    s = _blank(prs)
    _rect(s, 0, 0, 13.333, 7.5, fill=th["primary"])
    _gradient(s.shapes[-1], th["primary"], th["dark"], angle=120)
    _text(s, 0.9, 1.4, 6, 4.5, num, size=200, color=lighten(th["primary"], 0.42),
          bold=True, anchor="middle", en=True)
    _rect(s, 5.4, 3.0, 0.18, 1.5, fill=th["gold"])
    _text(s, 5.8, 2.9, 7, 1.7, title, size=40, color="FFFFFF", bold=True, anchor="middle")
    _footer(s, th, idx, brand)
    return s


def add_bullets(prs, th, title, items, brand, idx, kicker=None):
    s = _blank(prs)
    _content_header(s, th, title, kicker)
    y = 1.7
    for i, it in enumerate(items):
        _rect(s, 0.95, y + 0.06, 0.32, 0.32, fill=th["accent"], shape=MSO_SHAPE.OVAL)
        _text(s, 0.95, y + 0.04, 0.32, 0.32, str(i + 1), size=12, color="FFFFFF",
              bold=True, align="center", anchor="middle", en=True)
        if isinstance(it, tuple):
            head, body = it
            _text(s, 1.45, y - 0.02, 10.9, 0.4, head, size=15, color=th["dark"], bold=True)
            _text(s, 1.45, y + 0.38, 10.9, 0.5, body, size=11.5, color=th["muted"])
            y += 1.05
        else:
            _text(s, 1.45, y, 10.9, 0.5, it, size=14.5, color=th["text"])
            y += 0.72
    _footer(s, th, idx, brand)
    return s


def add_two_col(prs, th, title, left_title, left, right_title, right, brand, idx):
    s = _blank(prs)
    _content_header(s, th, title)
    # 左栏
    _rect(s, 0.7, 1.7, 5.7, 0.5, fill=th["light"])
    _text(s, 0.85, 1.72, 5.4, 0.46, left_title, size=14, color=th["primary"],
          bold=True, anchor="middle")
    y = 2.35
    for it in left:
        _rect(s, 0.95, y + 0.05, 0.14, 0.14, fill=th["accent"], shape=MSO_SHAPE.OVAL)
        _text(s, 1.2, y - 0.02, 5.1, 0.5, it, size=12.5, color=th["text"])
        y += 0.62
    # 右栏
    _rect(s, 6.9, 1.7, 5.7, 0.5, fill=th["light"])
    _text(s, 7.05, 1.72, 5.4, 0.46, right_title, size=14, color=th["primary"],
          bold=True, anchor="middle")
    y = 2.35
    for it in right:
        _rect(s, 7.15, y + 0.05, 0.14, 0.14, fill=th["gold"], shape=MSO_SHAPE.OVAL)
        _text(s, 7.4, y - 0.02, 5.1, 0.5, it, size=12.5, color=th["text"])
        y += 0.62
    _footer(s, th, idx, brand)
    return s


def add_image(prs, th, title, caption, brand, idx):
    s = _blank(prs)
    _content_header(s, th, title)
    _rect(s, 0.7, 1.7, 11.9, 4.9, line=th["accent"], lw=1.5, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    s.shapes[-1].line.dash_style = 2
    _text(s, 0.7, 3.4, 11.9, 0.7, "图片 / IMAGE", size=22, color=th["accent"],
          bold=True, align="center", anchor="middle", en=True)
    _text(s, 0.7, 4.15, 11.9, 0.5, caption, size=13, color=th["muted"],
          align="center", anchor="middle")
    _footer(s, th, idx, brand)
    return s


def add_stats(prs, th, title, stats, brand, idx, kicker=None):
    s = _blank(prs)
    _content_header(s, th, title, kicker)
    n = len(stats)
    total_w = 11.9
    gap = 0.35
    cw = (total_w - gap * (n - 1)) / n
    x = 0.7
    y = 2.4
    ch = 3.0
    for num, label in stats:
        _rect(s, x, y, cw, ch, fill=th["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        _rect(s, x, y, cw, 0.16, fill=th["accent"])
        _text(s, x, y + 0.55, cw, 1.4, num, size=46, color=th["primary"], bold=True,
              align="center", anchor="middle", en=True)
        _text(s, x, y + 2.0, cw, 0.7, label, size=14, color=th["dark"], bold=True,
              align="center", anchor="middle")
        x += cw + gap
    _footer(s, th, idx, brand)
    return s


def add_timeline(prs, th, title, steps, brand, idx):
    s = _blank(prs)
    _content_header(s, th, title)
    n = len(steps)
    x0, x1 = 1.0, 12.3
    span = (x1 - x0) / n
    y = 3.6
    _rect(s, x0, y, x1 - x0, 0.05, fill=th["accent"])
    for i, (tag, label) in enumerate(steps):
        cx = x0 + span * i + span / 2
        _rect(s, cx - 0.32, y - 0.27, 0.64, 0.64, fill=th["primary"], shape=MSO_SHAPE.OVAL)
        _text(s, cx - 0.32, y - 0.27, 0.64, 0.64, str(i + 1), size=16, color="FFFFFF",
              bold=True, align="center", anchor="middle", en=True)
        above = (i % 2 == 0)
        ty = y - 1.35 if above else y + 0.55
        _text(s, cx - span / 2 + 0.1, ty, span - 0.2, 0.4, tag, size=13, color=th["primary"],
              bold=True, align="center", anchor="middle", en=True)
        _text(s, cx - span / 2 + 0.1, ty + 0.4, span - 0.2, 0.7, label, size=11,
              color=th["muted"], align="center")
    _footer(s, th, idx, brand)
    return s


def add_closing(prs, th, title, subtitle, brand):
    s = _blank(prs)
    _rect(s, 0, 0, 13.333, 7.5, fill=th["dark"])
    _gradient(s.shapes[-1], th["dark"], th["primary"], angle=60)
    _rect(s, 0.95, 3.0, 0.22, 1.5, fill=th["gold"])
    _text(s, 1.35, 2.95, 10.5, 1.6, title, size=44, color="FFFFFF", bold=True, anchor="middle")
    _text(s, 1.38, 4.6, 10.5, 0.7, subtitle, size=17, color="DCE6F1", en=True)
    _text(s, 1.35, 6.4, 10, 0.4, brand, size=12, color="AFC4DC", en=True)
    return s


def render_ppt(spec, out_path):
    th = theme(spec.get("theme", 0))
    brand = spec.get("brand", "寄海文库 · 模板中心")
    prs = new_presentation()
    slides = spec["slides"]
    add_title(prs, th, spec["title"], spec.get("subtitle", ""), brand,
              spec.get("date", "2026"))
    idx = 1
    for sl in slides:
        t = sl["type"]
        idx += 1
        if t == "agenda":
            add_bullets(prs, th, sl.get("title", "目录"), sl["items"], brand, idx,
                        kicker=sl.get("kicker"))
        elif t == "section":
            add_section(prs, th, sl["num"], sl["title"], brand, idx)
            # 分节页后内容从下一页继续，idx 已计
        elif t == "bullets":
            add_bullets(prs, th, sl["title"], sl["items"], brand, idx, sl.get("kicker"))
        elif t == "two_col":
            add_two_col(prs, th, sl["title"], sl["left_title"], sl["left"],
                        sl["right_title"], sl["right"], brand, idx)
        elif t == "image":
            add_image(prs, th, sl["title"], sl.get("caption", "请在此处插入相关图片"),
                      brand, idx)
        elif t == "stats":
            add_stats(prs, th, sl["title"], sl["stats"], brand, idx, sl.get("kicker"))
        elif t == "timeline":
            add_timeline(prs, th, sl["title"], sl["steps"], brand, idx)
    add_closing(prs, th, spec.get("closing_title", "感谢观看"),
                spec.get("closing_subtitle", "THANK YOU"), brand)
    prs.save(out_path)
