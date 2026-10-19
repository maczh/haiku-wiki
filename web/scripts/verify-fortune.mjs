import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import Excel from 'exceljs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.join(root, 'node_modules/.haiku-fortune-verify')
await mkdir(directory, { recursive: true })
const outfile = path.join(directory, 'fortune.mjs')
try {
  await build({ entryPoints: [path.join(root, 'src/lib/office/fortune.ts')], outfile, platform: 'node', bundle: true, format: 'esm', packages: 'external' })
  const { readXlsx, writeXlsx, toFortune, fromFortune } = await import(pathToFileURL(outfile).href)
  const source = new Excel.Workbook()
  const sheet = source.addWorksheet('收支')
  sheet.getCell('A1').value = '季度收支'
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF217346' } }
  sheet.mergeCells('A1:C1')
  sheet.getCell('A5').value = 125.5
  sheet.getCell('A5').numFmt = '#,##0.00'
  sheet.getCell('B5').value = { formula: "A5+'参数'!A1", result: 135.5 }
  sheet.getCell('C7').value = new Date('2026-10-19T00:00:00Z')
  sheet.getCell('C7').numFmt = 'yyyy-mm-dd'
  sheet.getRow(5).height = 30
  sheet.getColumn(1).width = 24
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
  source.addWorksheet('参数').getCell('A1').value = 10
  source.addWorksheet('空白工作表')
  const bytes = await source.xlsx.writeBuffer()
  const imported = await readXlsx(bytes)
  assert.equal(imported.sheets.length, 3)
  assert.ok(imported.sheets[0].celldata.some(cell => cell.r === 4 && cell.c === 0 && cell.v.v === 125.5), 'blank rows must retain their positions')
  const normalized = fromFortune(toFortune(imported))
  const blob = await writeXlsx(normalized)
  const output = new Excel.Workbook()
  await output.xlsx.load(await blob.arrayBuffer())
  assert.equal(output.worksheets.length, 3)
  const result = output.getWorksheet('收支')
  assert.equal(result.getCell('A5').value, 125.5)
  assert.equal(result.getCell('B5').formula, "A5+'参数'!A1")
  assert.equal(result.getCell('B5').result, 135.5)
  assert.ok(result.getCell('C1').isMerged)
  assert.equal(result.getCell('A1').font.bold, true)
  assert.equal(result.getCell('A1').font.color.argb, 'FF217346')
  assert.equal(result.getCell('A5').numFmt, '#,##0.00')
  assert.equal(result.getRow(5).height, 30)
  assert.equal(result.getColumn(1).width, 24)
  assert.equal(result.getCell('C7').value.toISOString(), '2026-10-19T00:00:00.000Z')
  assert.equal(result.views[0].xSplit, 1)
  assert.equal(result.views[0].ySplit, 1)
  const edited = fromFortune([{ name: '最新修改', id: 'edit', data: [[{ v: 99 }, { f: '=A1+1' }]], celldata: [{ r: 0, c: 0, v: { v: 1 } }] }])
  assert.equal(edited.sheets[0].celldata[0].v.v, 99, 'current edits must replace stale initialization cells')
  assert.equal(edited.sheets[0].celldata[1].v.f, '=A1+1', 'uncached formula must survive save')
  assert.equal(edited.sheets[0].data, undefined, 'persist sparse cells only')
  const reordered = toFortune({ version: 3, sheets: [{ name: '后移', order: 1, celldata: [] }, { name: '前移', order: 0, celldata: [] }] })
  assert.equal(reordered[0].order, 1, 'preserve sheet tab order after reopening')
  assert.equal(reordered[1].order, 0)
  console.log('FortuneSheet XLSX roundtrip: sheets, formulas, blank rows, merges, dates, styles, dimensions, frozen panes, latest edits passed')
} finally {
  await rm(directory, { recursive: true, force: true })
}
