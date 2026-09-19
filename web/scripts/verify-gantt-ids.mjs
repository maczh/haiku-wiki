/**
 * 甘特图 id 归一化的 node 侧验证。
 *
 * 与 verify-dashboard.mjs 同一套做法：用 esbuild 把**产品代码本身**
 * （src/lib/gantt.ts）现场转译成 ESM 再 import 断言 —— 逻辑一改这里立刻失败，不是复刻品。
 *
 * 背景（2026-09-19 探针实测）：
 *   界面「新增任务」的 id 由 SVAR 内部生成（`temp://<毫秒时间戳>`），`api.serialize()`
 *   把它原样交回 → 直接落库就把**临时 id 持久化**了。附带后果：这类 id 在 DOM 上被渲染成
 *   `:temp://…`（多一个 `:` 前缀），凡是按 id 拼的 CSS 选择器（优先级外框）都会静默失配。
 *
 * 覆盖：
 *   ① 数字 id 原样保留（顺序与字段不动）；
 *   ② 临时 id → 数字 id（max + 1 起，按出现顺序，跳过已占用）；
 *   ③ 子任务的 parent 指向临时父 → 同步改写；
 *   ④ links 的 source/target 同步改写，依赖自身的 id 也稳定化；
 *   ⑤ 幂等：对输出再跑一遍结果不变（同一会话里的多次自动保存不能把 id 换来换去）；
 *   ⑥ 落库串里不再出现 `temp://`；
 *   ⑦ svarDataIdCandidates：数字一条，临时 id 给出「原样 + `:` 前缀」两条；
 *   ⑧ 真实场景：默认 3 条 + 新增同级任务 + 新增子任务。
 *
 * 运行：npm run verify:gantt-ids
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
 * 产物落在项目内 node_modules/.hk-verify 下，只有放在项目里 node 才能解析到
 * 被标为 external 的依赖。
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
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** 造一条 SVAR 形态的任务（字段名与 api.serialize() 交回的一致） */
function sv(id, over = {}) {
  return {
    id,
    text: `T${String(id)}`,
    start: new Date(2026, 8, 19),
    duration: 3,
    progress: 0,
    type: 'task',
    parent: 0,
    ...over,
  }
}

const TMP = 'temp://1789821459269'
const TMP2 = 'temp://1789821459270'

async function main() {
  const { mod, cleanup } = await loadModule('src/lib/gantt.ts', 'gantt')
  const ids = (r) => r.tasks.map((t) => String(t.id)).join(',')
  try {
    console.log('① 数字 id 原样保留')
    const r1 = mod.ganttFromSvar([sv(1, { type: 'summary' }), sv(2, { parent: 1 }), sv(3, { parent: 1 })], [])
    check('id 顺序不变', ids(r1) === '1,2,3', `实际 ${ids(r1)}`)
    check('id 类型仍是数字', r1.tasks.every((t) => typeof t.id === 'number'))
    check('parent 原样保留', r1.tasks[1].parent === 1 && r1.tasks[2].parent === 1)
    check('顶层 parent 为 0', r1.tasks[0].parent === 0)

    console.log('② 临时 id → 数字 id')
    const r2 = mod.ganttFromSvar(
      [sv(1, { type: 'summary' }), sv(2, { parent: 1 }), sv(3, { parent: 1 }), sv(TMP, { text: '新任务' })],
      [],
    )
    check('临时 id 被稳定成 max+1', ids(r2) === '1,2,3,4', `实际 ${ids(r2)}`)
    check('落库串不再含 temp://', !JSON.stringify(r2).includes('temp://'))
    check('文本等字段不受影响', r2.tasks[3].text === '新任务')

    console.log('③ 临时 id 作为父任务')
    const r3 = mod.ganttFromSvar([sv(1), sv(TMP, { type: 'summary' }), sv(TMP2, { parent: TMP })], [])
    check('临时父被稳定成 2', r3.tasks[1].id === 2, `实际 ${r3.tasks[1].id}`)
    check('子任务 parent 同步改写', r3.tasks[2].parent === 2, `实际 ${r3.tasks[2].parent}`)
    check('子任务自身 id 也稳定成 3', r3.tasks[2].id === 3, `实际 ${r3.tasks[2].id}`)

    console.log('④ 依赖 links 的引用同步改写')
    const r4 = mod.ganttFromSvar(
      [sv(1), sv(2), sv(TMP)],
      [{ id: 'temp://l1', source: 1, target: TMP, type: 'e2s', lag: 0 }],
    )
    check('source 保持为 1', r4.links[0].source === 1)
    check('target 指向稳定后的 3', r4.links[0].target === 3, `实际 ${r4.links[0].target}`)
    check('依赖自身 id 稳定成数字', typeof r4.links[0].id === 'number', `实际 ${r4.links[0].id}`)

    console.log('⑤ 幂等：已落库的数据再跑一遍不变')
    const round = r2.tasks.map((t) => ({ ...t, start: new Date(`${t.start}T00:00:00`) }))
    const again = mod.ganttFromSvar(round, r2.links)
    check('二次归一化结果完全一致', JSON.stringify(again) === JSON.stringify(r2))
    check('数字 id 不会被重新分配', ids(again) === '1,2,3,4', `实际 ${ids(again)}`)

    console.log('⑥ 数字 id 与「数字字符串 id」互不冲突')
    const r6 = mod.ganttFromSvar([sv(1), sv('7'), sv(TMP)], [])
    check('"7" 归一为 7，临时 id 顺延到 8', ids(r6) === '1,7,8', `实际 ${ids(r6)}`)

    console.log('⑦ svarDataIdCandidates：DOM data-id 的候选形态')
    check('数字 id → 只有一种形态', mod.svarDataIdCandidates(3).join('|') === '3')
    check('临时 id → 原样 + `:` 前缀两种', mod.svarDataIdCandidates(TMP).join('|') === `${TMP}|:${TMP}`)

    console.log('⑧ 真实场景：默认 3 条 + 新增任务 + 新增子任务')
    const real = mod.ganttFromSvar(
      [
        sv(1, { type: 'summary', text: '项目启动' }),
        sv(2, { parent: 1, text: '需求调研' }),
        sv(3, { parent: 1, text: '方案设计' }),
        sv('temp://1000', { text: '新任务' }),
        sv('temp://1001', { parent: 'temp://1000', text: '新子任务' }),
      ],
      [],
    )
    check('新任务分到 4、其子任务分到 5', ids(real) === '1,2,3,4,5', `实际 ${ids(real)}`)
    check('新子任务的 parent 指向 4', real.tasks[4].parent === 4, `实际 ${real.tasks[4].parent}`)
    check('层级与文本保持', real.tasks[1].parent === 1 && real.tasks[4].text === '新子任务')
  } finally {
    await cleanup()
  }

  console.log(`\nRESULT: PASS=${failed === 0 ? 'all' : 'partial'} FAIL=${failed}`)
  if (failed === 0) console.log('GANTT_IDS_VERIFY_OK')
  else process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
