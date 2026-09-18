// 浏览器端 .docx 生成（B2）：Blocks → Word 文档。
//
// 选型：docx（npm，官方推荐版本 9.x）——纯 JS 生成 OOXML，无服务端依赖，
// 可在浏览器直接产出 Blob，与现有 saveBlob（showSaveFilePicker 优先）无缝衔接。
//
// 保真策略（尽力而为）：
//   · 标题层级 → Word 的 Heading1~6；
//   · 段落 → 普通段落，行内粗体/斜体/行内代码/链接分别映射；
//   · 列表 → 项目符号 / 编号段落；
//   · 代码块 → 等宽字体 + 浅灰底纹段落，逐行成段；
//   · 表格 → Word 表格（首行加粗当作表头）；
//   · 图片 → 抓取字节嵌入；抓取失败降级为「图片：链接文字」段落，绝不中断导出。

import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { type Block, type InlineRun, plainOf } from './blocks'

/** 单张图片的最大嵌入宽度（px，超过按比例缩放） */
const MAX_IMG_WIDTH = 520

/** fetch 图片字节；失败返回 null（由调用方降级为链接文字） */
export async function fetchImage(url: string): Promise<{ data: ArrayBuffer; width?: number; height?: number } | null> {
  try {
    const resp = await fetch(url, { mode: 'cors' })
    if (!resp.ok) return null
    const data = await resp.arrayBuffer()
    if (data.byteLength === 0) return null
    const size = await measureImage(url).catch(() => null)
    return { data, width: size?.width, height: size?.height }
  } catch {
    return null
  }
}

/** 用 Image 元素量出自然尺寸（用于按比例缩放；量不到就交回 undefined） */
async function measureImage(url: string): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 })
    img.onerror = () => reject(new Error('图片无法加载'))
    img.src = url
  })
}

/** InlineRun[] → TextRun[] */
function toTextRuns(list: InlineRun[], base: { font?: string; color?: string } = {}): TextRun[] {
  return (list ?? []).map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic,
        font: r.code ? 'Consolas' : base.font,
        color: r.code ? 'C7254E' : base.color,
        ...(r.link ? { link: r.link } : {}),
      }),
  )
}

/** 标题级别 → docx 的 HeadingLevel */
function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const map = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ]
  return map[Math.min(5, Math.max(0, level - 1))]
}

/** Blocks → .docx Blob */
export async function buildDocx(blocks: Block[], title: string): Promise<Blob> {
  const children: (Paragraph | Table)[] = []

  // 文档标题（文档名即一级标题；正文里的一级标题顺延为二级以下的层级不变）
  children.push(
    new Paragraph({ text: title || '未命名文档', heading: HeadingLevel.TITLE, alignment: AlignmentType.LEFT }),
  )

  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        children.push(new Paragraph({ text: b.text, heading: headingLevel(b.level), spacing: { before: 200, after: 120 } }))
        break
      case 'paragraph':
        children.push(new Paragraph({ children: toTextRuns(b.runs), spacing: { after: 120 } }))
        break
      case 'list':
        for (const item of b.items) {
          children.push(
            new Paragraph({
              children: toTextRuns(item),
              bullet: b.ordered ? undefined : { level: 0 },
              ...(b.ordered ? { numbering: { reference: 'hk-ordered', level: 0, instance: 0 } } : {}),
              spacing: { after: 60 },
            }),
          )
        }
        break
      case 'code':
        for (const line of (b.text || '').split('\n')) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line === '' ? ' ' : line, font: 'Consolas', size: 20 })],
              shading: { fill: 'F5F5F5' },
              spacing: { after: 0 },
            }),
          )
        }
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        break
      case 'quote':
        children.push(
          new Paragraph({
            children: [new TextRun({ text: plainOf(b.runs), italics: true, color: '5F6672' })],
            indent: { left: 360 },
            spacing: { after: 120 },
          }),
        )
        break
      case 'table':
        if (b.rows.length > 0) {
          children.push(buildTable(b.rows))
          children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        }
        break
      case 'image': {
        const img = await fetchImage(b.url)
        if (img) {
          let width = img.width && img.width > 0 ? img.width : MAX_IMG_WIDTH
          let height = img.height && img.height > 0 ? img.height : Math.round((MAX_IMG_WIDTH * 3) / 4)
          if (width > MAX_IMG_WIDTH) {
            height = Math.round((height * MAX_IMG_WIDTH) / width)
            width = MAX_IMG_WIDTH
          }
          children.push(
            new Paragraph({
              children: [new ImageRun({ type: 'png', data: new Uint8Array(img.data), transformation: { width, height } })],
              spacing: { after: 120 },
            }),
          )
        } else {
          // 降级：图片抓不到（跨域/外链失效）时保留链接文字，不让整篇导出失败
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `[图片] ${b.alt || ''} ${b.url}`, color: '8A919F', size: 20 })],
              spacing: { after: 120 },
            }),
          )
        }
        break
      }
      case 'divider':
        children.push(new Paragraph({ text: '', border: { bottom: { style: 'single', size: 6, color: 'D9D9D9' } }, spacing: { after: 160 } }))
        break
      default:
        break
    }
  }

  const doc = new Document({
    sections: [{ children }],
    // 有序列表的编号定义（docx 库要求显式声明 numbering 才能用 numbering 引用）
    numbering: {
      config: [
        {
          reference: 'hk-ordered',
          levels: [{ level: 0, format: 'decimal' as never, text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
  })
  return await Packer.toBlob(doc)
}

/** GFM 表格 → docx 表格（首行加粗） */
function buildTable(rows: string[][]): Table {
  const colCount = Math.max(...rows.map((r) => r.length))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, ri) => {
      const cells: TableCell[] = []
      for (let c = 0; c < colCount; c++) {
        const text = row[c] ?? ''
        cells.push(
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text, bold: ri === 0 })],
                spacing: { after: 0 },
              }),
            ],
          }),
        )
      }
      return new TableRow({ children: cells, tableHeader: ri === 0 })
    }),
  })
}
