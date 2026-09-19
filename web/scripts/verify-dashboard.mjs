/**
 * 首页 Dashboard 纯逻辑的 node 侧验证。
 *
 * 与 verify-html-import.mjs / verify-sheet-export.mjs 同一套做法：用 esbuild 把
 * **产品代码本身**（src/lib/dashboard.ts）现场转译成 ESM 再 import 断言，
 * 逻辑一改这里立刻失败，不是复刻品。
 *
 * 覆盖：
 *   ① relativeTime 的六个分档 + 非法输入 + 未来时间（时钟偏差）；
 *   ② sortRecentDocs 倒序、脏数据靠后、不改动入参；
 *   ③ greetingOf 的分档边界；
 *   ④ dashboardStats 计数（含字段缺省）；
 *   ⑤ 关闭标记 readFlag / writeFlag 的读写与清除，存储不可用时静默不抛；
 *   ⑥ firstWritableBook 的优先级（可写 > 非公司库 > 第一本）；
 *   ⑦ defaultTitleOf 的已知类型与未知类型回退。
 *
 * 运行：npm run verify:dashboard
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
    external: ['dayjs'],
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** 最小内存存储，模拟 localStorage（并记录 setItem/removeItem 调用） */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  const calls = []
  return {
    calls,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      calls.push(['set', k, v])
      map.set(k, v)
    },
    removeItem: (k) => {
      calls.push(['remove', k])
      map.delete(k)
    },
    dump: () => Object.fromEntries(map),
  }
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

async function main() {
  const dash = await loadModule('src/lib/dashboard.ts', 'dashboard')
  try {
    const {
      relativeTime,
      sortRecentDocs,
      greetingOf,
      dashboardStats,
      readFlag,
      writeFlag,
      firstWritableBook,
      defaultTitleOf,
      ONBOARD_DISMISS_KEY,
      INTRO_DISMISS_KEY,
      DOC_TYPE_DEFAULT_TITLE,
    } = dash.mod

    // ---------- ① relativeTime ----------
    console.log('\n① relativeTime 分档')
    const now = Date.UTC(2026, 8, 19, 6, 0, 0) // 固定"现在"，避免测试随时钟漂移
    check('30 秒前 → 刚刚', relativeTime(now - 30 * 1000, now) === '刚刚', relativeTime(now - 30 * 1000, now))
    check('1 分钟前 → 1 分钟前', relativeTime(now - MINUTE, now) === '1 分钟前')
    check('59 分钟前 → 59 分钟前', relativeTime(now - 59 * MINUTE, now) === '59 分钟前')
    check('60 分钟前 → 1 小时前', relativeTime(now - HOUR, now) === '1 小时前')
    check('23 小时前 → 23 小时前', relativeTime(now - 23 * HOUR, now) === '23 小时前')
    check('24 小时前 → 1 天前', relativeTime(now - DAY, now) === '1 天前')
    check('29 天前 → 29 天前', relativeTime(now - 29 * DAY, now) === '29 天前')
    const oldOne = relativeTime(now - 40 * DAY, now)
    check('40 天前 → 绝对日期 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(oldOne), oldOne)
    check('未来时间（时钟偏差）→ 刚刚', relativeTime(now + 5 * MINUTE, now) === '刚刚')
    check('空值 → 空串', relativeTime('', now) === '' && relativeTime(null, now) === '' && relativeTime(undefined, now) === '')
    check('非法日期 → 空串（不显示 NaN）', relativeTime('not-a-date', now) === '', relativeTime('not-a-date', now))
    check('支持 Date 对象入参', relativeTime(new Date(now - 2 * HOUR), now) === '2 小时前')

    // ---------- ② sortRecentDocs ----------
    console.log('\n② sortRecentDocs')
    const raw = [
      { id: 1, updated_at: '2026-09-19T02:00:00Z' },
      { id: 2, updated_at: '2026-09-19T05:00:00Z' },
      { id: 3, updated_at: '2026-09-19T03:00:00Z' },
    ]
    const sorted = sortRecentDocs(raw)
    check('按更新时间倒序', sorted.map((x) => x.id).join(',') === '2,3,1', sorted.map((x) => x.id).join(','))
    check('不改动入参', raw.map((x) => x.id).join(',') === '1,2,3')
    const withBad = sortRecentDocs([{ id: 1, updated_at: 'bad' }, { id: 2, updated_at: '2026-09-19T05:00:00Z' }])
    check('脏数据排到最后', withBad[withBad.length - 1].id === 1, withBad.map((x) => x.id).join(','))
    check('空数组安全', Array.isArray(sortRecentDocs([])) && sortRecentDocs([]).length === 0)

    // ---------- ③ greetingOf ----------
    console.log('\n③ greetingOf 边界')
    const at = (h) => new Date(2026, 8, 19, h, 30, 0)
    check('5 点 → 凌晨好', greetingOf(at(5)) === '凌晨好', greetingOf(at(5)))
    check('6 点 → 早上好', greetingOf(at(6)) === '早上好')
    check('8 点 → 早上好', greetingOf(at(8)) === '早上好')
    check('9 点 → 上午好', greetingOf(at(9)) === '上午好')
    check('11 点 → 上午好', greetingOf(at(11)) === '上午好')
    check('12 点 → 中午好', greetingOf(at(12)) === '中午好')
    check('14 点 → 下午好', greetingOf(at(14)) === '下午好')
    check('18 点 → 晚上好', greetingOf(at(18)) === '晚上好')
    check('23 点 → 晚上好', greetingOf(at(23)) === '晚上好')

    // ---------- ④ dashboardStats ----------
    console.log('\n④ dashboardStats')
    const s = dashboardStats({ mine: [1, 2], visible: [3], teams: [4, 5, 6], recent: [{}] })
    check('可见知识库 = mine + visible', s.books === 3, String(s.books))
    check('团队文库计数', s.teams === 3, String(s.teams))
    check('最近更新计数', s.recent === 1)
    const s0 = dashboardStats({})
    check('字段缺省时全 0', s0.books === 0 && s0.teams === 0 && s0.recent === 0)

    // ---------- ⑤ 关闭标记 ----------
    console.log('\n⑤ readFlag / writeFlag')
    const st = fakeStorage()
    check('默认未关闭', readFlag(ONBOARD_DISMISS_KEY, st) === false)
    writeFlag(ONBOARD_DISMISS_KEY, true, st)
    check('写入后可读回 true', readFlag(ONBOARD_DISMISS_KEY, st) === true)
    check('写入值为 "1"', st.dump()[ONBOARD_DISMISS_KEY] === '1')
    writeFlag(ONBOARD_DISMISS_KEY, false, st)
    check('置 false 时删除键', readFlag(ONBOARD_DISMISS_KEY, st) === false && st.dump()[ONBOARD_DISMISS_KEY] === undefined)
    check('两个 key 互不干扰', ONBOARD_DISMISS_KEY !== INTRO_DISMISS_KEY)
    check('无存储时视为未关闭', readFlag(INTRO_DISMISS_KEY, null) === false)
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
    }
    let threw = false
    try {
      readFlag('x', broken)
      writeFlag('x', true, broken)
    } catch {
      threw = true
    }
    check('存储抛错时静默（隐私模式 / 配额满）', threw === false)

    // ---------- ⑥ firstWritableBook ----------
    console.log('\n⑥ firstWritableBook')
    const company = { id: 9, name: '公司知识库', is_company_kb: true, can_write: false }
    const other = { id: 8, name: '他人只读库', can_write: false }
    const mineBook = { id: 7, name: '我的库', can_write: true }
    check('空数组 → null', firstWritableBook([]) === null)
    check('优先可写的库', firstWritableBook([company, other, mineBook])?.id === 7)
    check('无可写库时避开公司知识库', firstWritableBook([company, other])?.id === 8)
    check('只有公司知识库时仍返回它（不返回 null）', firstWritableBook([company])?.id === 9)

    // ---------- ⑦ defaultTitleOf ----------
    console.log('\n⑦ defaultTitleOf')
    check('markdown → 未命名文档', defaultTitleOf('markdown') === '未命名文档')
    check('gantt → 未命名甘特图', defaultTitleOf('gantt') === '未命名甘特图')
    check('未知类型回退未命名文档', defaultTitleOf('nope') === '未命名文档')
    check('九种可新建类型都有默认名', ['markdown', 'sheet', 'mindmap', 'flowchart', 'drawing', 'todo', 'calendar', 'gantt', 'api'].every((t) => !!DOC_TYPE_DEFAULT_TITLE[t]))
    check('folder 有默认名', defaultTitleOf('folder') === '未命名目录')
  } finally {
    await dash.cleanup()
  }

  // ---------- ⑧ 目录下拉选项契约（lib/dirOptions）----------
  // 这是本轮修复的核心：选项必须是 {value,label}，否则 AntD Select 会显示原始值 0
  // 且选了没效果（历史 bug）。
  const dirs = await loadModule('src/lib/dirOptions.ts', 'dirOptions')
  try {
    const { buildDirOptions, withRootDir, ROOT_DIR_VALUE, ROOT_DIR_LABEL, PICK_BOOK_FIRST } = dirs.mod
    console.log('\n⑧ 目录下拉选项（lib/dirOptions）')

    const node = (id, parent_id, title, doc_type = 'markdown', pos = 'a', pinned_at = null) => ({
      id, book_id: 1, parent_id, title, doc_type, pos, pinned_at, updated_at: '2026-09-19T00:00:00Z',
    })
    // 结构：RIS项目(目录) ├ 需求说明 ├ IOT项目(目录) └ 子目录(目录)
    const docs = [
      node(10, 0, 'RIS项目', 'folder', 'a'),
      node(11, 10, '需求说明', 'markdown', 'a'),
      node(12, 0, 'IOT项目', 'folder', 'b'),
      node(13, 10, '子目录', 'folder', 'b'),
      node(14, 11, '深层文档', 'markdown', 'a'),
    ]
    const opts = buildDirOptions(docs)

    check('每项都有 value 字段（AntD 契约）', opts.every((o) => typeof o.value === 'number'))
    check('每项都有 label 字段', opts.every((o) => typeof o.label === 'string' && o.label.length > 0))
    check('没有遗留的 id 字段', opts.every((o) => !('id' in o)))
    check('cover 全部节点（任意层级都可选）', opts.length === 5)
    check('深度优先顺序：RIS → 需求说明 → 深层文档 → 子目录 → IOT', opts.map((o) => o.value).join(',') === '10,11,14,13,12')
    check('顶层无缩进', opts[0].label === 'RIS项目（目录）')
    check('子节点按层级缩进', opts[1].label.startsWith('　') && !opts[1].label.slice(0, 1).trim())
    check('二级缩进更深', opts[2].label.startsWith('　　'))
    check('目录带（目录）后缀，普通文档不带', opts[2].label.endsWith('深层文档') && opts[0].label.endsWith('（目录）'))
    check('空文档列表 → 空数组', buildDirOptions([]).length === 0)

    const rooted = withRootDir(opts)
    check('补根目录后第一项是根目录', rooted[0].value === ROOT_DIR_VALUE && rooted[0].label === ROOT_DIR_LABEL)
    check('根目录 value 为 0（后端 parent_id=0 约定）', ROOT_DIR_VALUE === 0)
    check('withRootDir 不改动入参', opts.length === 5)

    // 置顶优先：与目录树展示顺序一致，否则下拉里的顺序会和左侧树对不上
    const pinned = buildDirOptions([node(20, 0, 'B', 'markdown', 'a'), node(21, 0, 'A', 'markdown', 'b', '2026-01-01T00:00:00Z')])
    check('置顶节点排在前面（与树一致）', pinned[0].value === 21)
    check('未选知识库提示文案存在', typeof PICK_BOOK_FIRST === 'string' && PICK_BOOK_FIRST.length > 0)
  } finally {
    await dirs.cleanup()
  }

  console.log(`\nRESULT: PASS=${failed === 0 ? 'all' : 'partial'} FAIL=${failed}`)
  if (failed === 0) console.log('DASHBOARD_VERIFY_OK')
  else process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
