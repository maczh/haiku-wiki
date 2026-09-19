/**
 * 首页「工作台」聚合逻辑的 node 侧验证。
 *
 * 与 verify-dashboard.mjs / verify-gantt-ids.mjs 同一套做法：用 esbuild 把**产品代码本身**
 * （src/lib/workbench.ts、src/lib/todo.ts）现场转译成 ESM 再 import 断言 ——
 * 逻辑一改这里立刻失败，不是复刻品。
 *
 * 为什么不只在浏览器里测：`lib/workbench.ts` 是刻意的纯函数层，时间和图幅都由外部注入。
 * 「任意时刻都成立」的口径（今天到期 ≠ 逾期、按期长加权）在这里断言最省事也最稳，
 * 浏览器套件（tools/verify/e2e-workbench-dnd.sh）负责渲染层，两者互补。
 *
 * 覆盖：
 *   ① hasWorkbench：三类都没有则整段不显示（需求原文「无则不显示」）；
 *   ② aggregateTodos：逾期 / 今天到期 / 有截止日 / 无截止日 的排序与计数；
 *   ③ **逾期边界**：只填日期的截止项在当天不算逾期（历史上当天 00:00 就判逾期，
 *      让「已逾期」多算、行内标签把「今天到期」显示成「已逾期」）；
 *   ④ 带具体时间的截止项仍按精确时刻判逾期；
 *   ⑤ aggregateGantt：**按期长加权**（与等权平均可区分）、排除 summary、里程碑按 1 天计权；
 *   ⑥ aggregateCalendar：排除已取消、今日与未来 7 天的划分、全天排定时之前；
 *   ⑦ pickWorkbenchDocs / dueDateKey。
 *
 * 运行：npm run verify:workbench
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

/** 造一条工作台文档（字段与后端 WorkbenchDoc 一致） */
function wb(id, docType, title, content, bookId = 1, bookName = '产品库') {
  return { id, title, doc_type: docType, book_id: bookId, book_name: bookName, updated_at: '', content }
}

const NOW = new Date(2026, 8, 19, 10, 30) // 2026-09-19 10:30 本地时间
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function todoJSON(items) {
  return JSON.stringify({
    version: 1,
    items: items.map((it, i) => ({ id: `t${i}`, note: '', priority: '', ...it })),
  })
}
function ganttJSON(tasks) {
  return JSON.stringify({ version: 1, tasks, links: [] })
}
function calendarJSON(tasks) {
  return JSON.stringify({ version: 1, tasks })
}

async function main() {
  const { mod, cleanup } = await loadModule('src/lib/workbench.ts', 'workbench')
  const { mod: todoMod } = await loadModule('src/lib/todo.ts', 'todo')
  try {
    console.log('① hasWorkbench：三类都没有则整段不显示')
    check('空数组 → false', mod.hasWorkbench([]) === false)
    check('undefined → false', mod.hasWorkbench(undefined) === false)
    check('只有 markdown → false', mod.hasWorkbench([wb(1, 'markdown', 'x', '')]) === false)
    check('有 todo → true', mod.hasWorkbench([wb(1, 'todo', 'x', '')]) === true)
    check('有 gantt → true', mod.hasWorkbench([wb(1, 'gantt', 'x', '')]) === true)
    check('有 calendar → true', mod.hasWorkbench([wb(1, 'calendar', 'x', '')]) === true)

    console.log('② dueDateKey：截止串归一成 YYYY-MM-DD')
    check('只填日期', mod.dueDateKey('2026-9-9') === '2026-09-09', mod.dueDateKey('2026-9-9'))
    check('带时间被截断', mod.dueDateKey('2026-09-19 18:00') === '2026-09-19', mod.dueDateKey('2026-09-19 18:00'))
    check('空串 → 空', mod.dueDateKey('') === '')

    console.log('③ aggregateTodos：排序「逾期 → 今天到期 → 有截止日 → 无」')
    const docs = [
      wb(
        7,
        'todo',
        '项目待办',
        todoJSON([
          { text: '无期限项', done: false, due: '' },
          { text: '将来项', done: false, due: '2026-12-01' },
          { text: '今天到期', done: false, due: '2026-09-19' },
          { text: '三天前逾期', done: false, due: '2026-09-16' },
          { text: '已完成项', done: true, due: '2026-01-01' },
        ]),
      ),
    ]
    const at = mod.aggregateTodos(docs, NOW)
    check('清单数 1', at.lists === 1, String(at.lists))
    check('总数 5', at.total === 5, String(at.total))
    check('已完成 1', at.done === 1, String(at.done))
    check('未完成 4', at.open === 4, String(at.open))
    check('逾期只算「三天前」那一条 = 1', at.overdue === 1, String(at.overdue))
    check(
      '排序：逾期 → 今天到期 → 将来 → 无期限',
      at.entries.map((e) => e.item.text).join(',') === '三天前逾期,今天到期,将来项,无期限项',
      at.entries.map((e) => e.item.text).join(','),
    )
    check('「今天到期」标了 dueToday', at.entries[1].dueToday === true)
    check('「今天到期」没被标逾期', at.entries[1].overdue === false)
    check('空行不计入统计', mod.aggregateTodos([wb(1, 'todo', 'x', todoJSON([{ text: '   ', done: false, due: '' }]))], NOW).total === 0)

    console.log('④ isOverdue 的逾期边界（当天整日都不算逾期）')
    const due = (d, extra = {}) => ({ id: 'x', text: 'x', done: false, due: d, priority: '', note: '', ...extra })
    check('只填今天 → 未逾期', todoMod.isOverdue(due(iso(2026, 9, 19)), NOW) === false)
    check('只填昨天 → 已逾期', todoMod.isOverdue(due(iso(2026, 9, 18)), NOW) === true)
    check('只填明天 → 未逾期', todoMod.isOverdue(due(iso(2026, 9, 20)), NOW) === false)
    check('今天 23:59 之前不算逾期', todoMod.isOverdue(due('2026-09-19 23:59'), NOW) === false)
    check('今天 09:00（已过）→ 已逾期', todoMod.isOverdue(due('2026-09-19 09:00'), NOW) === true)
    check('datetime-local 的 T 分隔也认', todoMod.isOverdue(due('2026-09-19T09:00'), NOW) === true)
    check('已完成即便过期也不算逾期', todoMod.isOverdue(due('2020-01-01', { done: true }), NOW) === false)
    check('空截止 → 不算逾期', todoMod.isOverdue(due(''), NOW) === false)
    check('脏数据 → 不算逾期', todoMod.isOverdue(due('待定'), NOW) === false)

    console.log('⑤ aggregateGantt：按期长加权 + 排除 summary + 里程碑按 1 天计权')
    // 1 天 100% + 9 天 0% → 加权 = (100*1 + 0*9)/10 = 10%；等权平均会是 50%
    const gd = [
      wb(
        8,
        'gantt',
        '项目甘特',
        ganttJSON([
          { id: 1, text: '汇报用汇总', start: '2026-09-01', duration: 20, progress: 100, type: 'summary' },
          { id: 2, text: '一天的任务', start: '2026-09-01', duration: 1, progress: 100, type: 'task' },
          { id: 3, text: '九天的任务', start: '2026-09-02', duration: 9, progress: 0, type: 'task' },
          { id: 4, text: '里程碑', start: '2026-09-30', duration: 0, progress: 0, type: 'milestone' },
        ]),
      ),
    ]
    const ga = mod.aggregateGantt(gd, NOW)
    check('排除 summary 后任务数 3', ga.tasks === 3, String(ga.tasks))
    // 加权：(100*1 + 0*9 + 0*1)/11 = 9.09 → 9%
    check('加权平均进度 = 9%（等权会得 33%）', ga.progress === 9, String(ga.progress))
    check('汇总条的 100% 没被计入', ga.progress < 50, String(ga.progress))
    check('里程碑按 1 天计权（拉低了平均）', ga.progress === 9, String(ga.progress))
    check('图表数 1', ga.charts === 1, String(ga.charts))
    check('行里带书名与标题', ga.rows[0].bookName === '产品库' && ga.rows[0].title === '项目甘特')

    console.log('⑥ aggregateCalendar：排除已取消 + 今日/未来 7 天划分')
    const cd = [
      wb(
        9,
        'calendar',
        '项目日历',
        calendarJSON([
          { id: 'c1', title: '今日全天', start: '2026-09-19', end: '', done: false, cancelled: false, note: '' },
          { id: 'c2', title: '今日十点', start: '2026-09-19 10:00', end: '', done: false, cancelled: false, note: '' },
          { id: 'c3', title: '已取消的日程', start: '2026-09-19 14:00', end: '', done: false, cancelled: true, note: '' },
          { id: 'c4', title: '三天后', start: '2026-09-22 09:00', end: '', done: false, cancelled: false, note: '' },
          { id: 'c5', title: '三十天后', start: '2026-10-19 09:00', end: '', done: false, cancelled: false, note: '' },
        ]),
      ),
    ]
    const ca = mod.aggregateCalendar(cd, NOW, 7)
    check('今日日程 2 条（已取消被排除）', ca.today.length === 2, String(ca.today.length))
    check('今日日程里没有「已取消的日程」', !ca.today.some((e) => e.title === '已取消的日程'))
    check('全天日程排在定时日程之前', ca.today[0].title === '今日全天' && ca.today[1].title === '今日十点', ca.today.map((e) => e.title).join(','))
    check('今日待完成 2 条', ca.pendingToday === 2, String(ca.pendingToday))
    check('未来 7 天内 1 条（三十天后的不算）', ca.upcoming.length === 1 && ca.upcoming[0].title === '三天后')

    console.log('⑦ pickWorkbenchDocs：按类型筛选')
    const mixed = [wb(1, 'todo', 'a', ''), wb(2, 'gantt', 'b', ''), wb(3, 'todo', 'c', ''), wb(4, 'markdown', 'd', '')]
    check('挑出 2 张待办清单', mod.pickWorkbenchDocs(mixed, 'todo').length === 2)
    check('挑出 1 张甘特', mod.pickWorkbenchDocs(mixed, 'gantt').length === 1)
    check('markdown 不混进工作台三类',
      mod.WORKBENCH_TYPES.every((t) => mod.pickWorkbenchDocs(mixed, t).every((it) => it.doc_type === t && it.id !== 4)))
  } finally {
    await cleanup()
  }

  console.log(`\nRESULT: PASS=${failed === 0 ? 'all' : 'partial'} FAIL=${failed}`)
  if (failed === 0) console.log('WORKBENCH_VERIFY_OK')
  else process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
