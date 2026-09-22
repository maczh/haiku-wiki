// 校验模板/文档里的 mermaid 源码能否被当前 mermaid（v11）解析。
//
// 用法：
//   node scripts/check-mermaid.mjs [--dir <含 .mmd 的目录>] [--json <模板json>] [--out <报告>]
//
// 默认校验 server/internal/repository/templates 下所有 doc_type=flowchart 的模板正文。
// 解析失败会把「模板名 + 首个错误行」打印出来，退出码 1（供 CI / 回归套件使用）。

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
global.HTMLElement = dom.window.HTMLElement
global.SVGElement = dom.window.SVGElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.DOMParser = dom.window.DOMParser
global.requestAnimationFrame = dom.window.requestAnimationFrame
global.getComputedStyle = dom.window.getComputedStyle

const mermaid = (await import('mermaid')).default
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })

const ROOT = resolve(process.argv[1], '../../..')
const args = process.argv.slice(2)
function arg(name, def) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

const targets = []
const jsonArg = arg('json')
const dirArg = arg('dir')
if (jsonArg) {
  targets.push({ kind: 'json', path: resolve(jsonArg) })
} else if (dirArg) {
  targets.push({ kind: 'dir', path: resolve(dirArg) })
} else {
  const tplDir = join(ROOT, 'server/internal/repository/templates')
  for (const f of readdirSync(tplDir).filter((n) => n.endsWith('.json')).sort()) {
    targets.push({ kind: 'json', path: join(tplDir, f) })
  }
}

const cases = []
for (const t of targets) {
  if (t.kind === 'json') {
    const doc = JSON.parse(readFileSync(t.path, 'utf8'))
    const defType = doc.doc_type || ''
    for (const it of doc.templates || []) {
      const dt = it.doc_type || defType
      if (dt !== 'flowchart') continue
      const c = it.content
      cases.push({ name: `${it.name}`, src: typeof c === 'string' ? c : JSON.stringify(c) })
    }
  } else {
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.mmd')) cases.push({ name: p, src: readFileSync(p, 'utf8') })
      }
    }
    walk(t.path)
  }
}

if (cases.length === 0) {
  console.log('✗ 没有找到任何 flowchart 模板（源文件缺失或 doc_type 写错），视为失败')
  process.exit(1)
}

let bad = 0
for (const c of cases) {
  try {
    const ok = await mermaid.parse(c.src, { suppressErrors: true })
    if (!ok) {
      bad++
      console.log(`✗ ${c.name}: 解析返回空（语法有误）`)
    }
  } catch (e) {
    bad++
    const msg = String(e && e.message ? e.message : e).replace(/\s+/g, ' ').slice(0, 220)
    console.log(`✗ ${c.name}: ${msg}`)
  }
}
console.log(`mermaid 解析校验：${cases.length} 条，失败 ${bad} 条`)
process.exit(bad ? 1 : 0)
