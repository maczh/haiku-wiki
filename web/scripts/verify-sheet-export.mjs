/**
 * 表格存储契约迁移 + 导出文件名/扩展名映射的 node 侧验证（第六轮第二批 B1/B2/B3）。
 *
 * 与 verify-html-import.mjs 同一套做法：用 esbuild 把 **产品代码本身** 现场转译成
 * ESM 再 import，断言的不是复制品，逻辑一改这里立刻失败。
 *
 * 覆盖：
 *   ① 旧格式 v1（{version:1,cells:{"r-c":{text}}}）→ v3（Luckysheet sheets）；
 *   ② 旧格式 v2（带 raw：x-data-spreadsheet 的 rows/cells）→ v3，行高列宽与表名保留；
 *   ③ v3 透传（不重复迁移、不丢多工作表）；
 *   ④ 损坏/不识别内容 → 回退空表且 reset=true；
 *   ⑤ getAllSheets() 输出 → SheetJSON（剔除 data 矩阵，减小体积）；
 *   ⑥ 导出文件名消毒与扩展名映射（docx/pptx/ppts/pdf）。
 *
 * 运行：npm run verify:sheet
 */
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')

let failed = 0

function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra ? ` —— ${extra}` : ''}`)
  }
}

/**
 * 把 TS 源码打包成 ESM 并 import（bundle:true，相对 import 一并解析）。
 *
 * 产物落在项目内 node_modules/.hk-verify 下：浏览器侧依赖被标为 external，
 * 只有放在项目里 node 才能解析到它们（搁系统临时目录会 ERR_MODULE_NOT_FOUND）。
 */
async function loadModule(entry, name) {
  const dir = path.join(root, 'node_modules/.hk-verify')
  await mkdir(dir, { recursive: true })
  const outfile = path.join(dir, `${name}.mjs`)
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    logLevel: 'silent',
    // dompurify 之类浏览器依赖在 node 下不可解析，这里只验证纯逻辑模块
    external: [
      'dompurify',
      'turndown',
      'docx',
      'pptxgenjs',
      'html2canvas',
      'jspdf',
      'luckysheet',
      'pptx-preview',
      'vditor',
      'mammoth',
    ],
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function main() {
  // ---------- ①~⑤ 表格存储契约（src/lib/sheet.ts） ----------
  const sheet = await loadModule('src/lib/sheet.ts', 'sheet')
  try {
    const { parseSheetJSON, luckysheetToSheetJSON, stringifySheet, flattenSheets, SHEET_VERSION } = sheet.mod

    // v1：扁平 cells 映射
    const v1 = JSON.stringify({
      version: 1,
      cells: { '0-0': { text: '姓名' }, '0-1': { text: '部门' }, '1-0': { text: '张三' }, '1-1': { text: '研发中心' } },
      colLen: 26,
      rowLen: 100,
    })
    const r1 = parseSheetJSON(v1)
    check('v1：识别为迁移（migrated=true）', r1.migrated === true)
    check('v1：未回退（reset=false）', r1.reset === false)
    check('v1：转成 v3 且只有一个工作表', r1.data.version === SHEET_VERSION && r1.data.sheets.length === 1)
    const f1 = flattenSheets(r1.data)
    check('v1：单元格 (0,0) 文本保留', f1.cells['0-0']?.text === '姓名')
    check('v1：单元格 (1,1) 文本保留', f1.cells['1-1']?.text === '研发中心')
    check('v1：行列数不小于原声明值', f1.colLen >= 26 && f1.rowLen >= 100)

    // v2：带 raw（x-data-spreadsheet 的 rows 结构，含表名与列数）
    const v2 = JSON.stringify({
      version: 2,
      cells: { '0-0': { text: '（扁平副本，优先级低于 raw）' } },
      colLen: 26,
      rowLen: 100,
      raw: {
        name: '人员表',
        rows: { 0: { cells: { 0: { text: '姓名' }, 1: { text: '部门' } } }, 1: { cells: { 0: { text: '李四' } } }, len: 100 },
        cols: { len: 8 },
      },
    })
    const r2 = parseSheetJSON(v2)
    check('v2：识别为迁移（migrated=true）', r2.migrated === true)
    check('v2：优先采用 raw 而非扁平 cells', flattenSheets(r2.data).cells['1-0']?.text === '李四')
    check('v2：raw 中的空单元格不产生脏数据', flattenSheets(r2.data).cells['1-1'] === undefined)
    check('v2：表名沿用 raw.name', r2.data.sheets[0].name === '人员表')

    // v3：透传
    const v3 = JSON.stringify({
      version: 3,
      sheets: [
        { name: 'A', index: 0, order: 0, status: 1, row: 50, column: 10, celldata: [{ r: 0, c: 0, v: { v: 'x', m: 'x' } }] },
        { name: 'B', index: 1, order: 1, status: 1, row: 50, column: 10, celldata: [{ r: 0, c: 0, v: 'y' }] },
      ],
    })
    const r3 = parseSheetJSON(v3)
    check('v3：原样透传（migrated=false）', r3.migrated === false)
    check('v3：多工作表全部保留', r3.data.sheets.length === 2 && r3.data.sheets[1].name === 'B')

    // 损坏 / 不识别
    for (const bad of ['{', 'null', '[]', '"文本"', '{"version":3}', '{"version":9,"foo":1}']) {
      const rb = parseSheetJSON(bad)
      check(`损坏内容「${bad.slice(0, 20)}」→ 回退空表且 reset=true`, rb.reset === true && rb.data.sheets.length === 1)
    }
    check('空字符串不算损坏（视为新表）', parseSheetJSON('').reset === false)

    // getAllSheets() 输出 → SheetJSON：剔除 data 矩阵
    const fromGetAll = luckysheetToSheetJSON([
      {
        name: 'Sheet1',
        index: 0,
        order: 0,
        status: 1,
        row: 100,
        column: 26,
        celldata: [{ r: 0, c: 0, v: { v: '标题', m: '标题', ct: { fa: 'General', t: 's' } } }],
        data: [[null, null], [null, null]], // getAllSheets() 会带上，落库前应剥离
      },
    ])
    const json = JSON.parse(stringifySheet(fromGetAll))
    check('getAllSheets 输出：data 矩阵被剥离（体积更小）', json.sheets[0].data === undefined)
    check('getAllSheets 输出：celldata 保留', json.sheets[0].celldata?.length === 1)
    check('getAllSheets 输出：version 为 v3', json.version === SHEET_VERSION)
    check('空数组兜底为一张空表', luckysheetToSheetJSON([]).sheets.length === 1)
  } finally {
    await sheet.cleanup()
  }

  // ---------- ⑥ 导出文件名 / 扩展名映射（src/lib/export/index.ts） ----------
  const exp = await loadModule('src/lib/export/index.ts', 'exportx')
  try {
    const { safeFilename, CLIENT_FORMAT_EXT, clientFormatsFor } = exp.mod

    check('.docx → docx', CLIENT_FORMAT_EXT.docx === 'docx')
    check('.pptx → pptx', CLIENT_FORMAT_EXT.pptx === 'pptx')
    check('.ppts → ppts（兼容扩展名）', CLIENT_FORMAT_EXT.ppts === 'ppts')
    check('.pdf → pdf', CLIENT_FORMAT_EXT.pdf === 'pdf')

    check('文件名按标题 + 扩展名', safeFilename('季度报告', 'docx') === '季度报告.docx')
    check('文件名去掉 Windows 非法字符', safeFilename('a/b:c*d?e"f<g>h|i', 'pdf') === 'a_b_c_d_e_f_g_h_i.pdf')
    check('空标题兜底为「未命名文档」', safeFilename('', 'pptx') === '未命名文档.pptx')

    const md = clientFormatsFor('markdown').map((f) => f.value)
    check('markdown 提供 .docx', md.includes('docx'))
    check('markdown 提供 .pdf', md.includes('pdf'))
    check('markdown 提供 .pptx/.ppts', md.includes('pptx') && md.includes('ppts'))
    for (const t of ['sheet', 'mindmap', 'todo', 'calendar', 'flowchart']) {
      const f = clientFormatsFor(t).map((x) => x.value)
      check(`${t} 也能导出 .docx/.pdf（B2 面向全部文档类型）`, f.includes('docx') && f.includes('pdf'))
    }
    check('drawing 不提供浏览器端格式（由编辑器内 draw.io 导出）', clientFormatsFor('drawing').length === 0)

    const dx = clientFormatsFor('file', 'docx').map((f) => f.value)
    check('docx 附件：.docx 原文件 + .pdf', dx.includes('docx') && dx.includes('pdf') && !dx.includes('pptx'))
    const px = clientFormatsFor('file', 'pptx').map((f) => f.value)
    check('pptx 附件：.pptx + .ppts + .pdf', px.includes('pptx') && px.includes('ppts') && px.includes('pdf'))
    check('其余附件（如 .zip）无浏览器端格式', clientFormatsFor('file', 'zip').length === 0)
  } finally {
    await exp.cleanup()
  }

  if (failed > 0) {
    console.error(`\n表格契约 / 导出映射验证失败：${failed} 项`)
    process.exit(1)
  }
  console.log('\n表格契约 / 导出映射验证全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
