import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { todoToHtml } = await load('src/lib/export/todo.ts')
const { contentToBlocks, plainOf } = await load('src/lib/export/blocks.ts')
const fixture = JSON.stringify({ version: 1, items: [
  { text: '共同任务<script>bad()</script>', done: false, assignees: ['乙', '甲', '乙'], project: '项目一', progress: 42, due: '2026-10-23', priority: 'high', note: '第一行\n第二行' },
  { text: '完成任务', done: true, assignees: ['甲'], progress: 5 },
  { text: '未分配任务', done: false, progress: 0 },
] })
const doc = new JSDOM(todoToHtml(fixture)).window.document
assert.equal(doc.querySelectorAll('section').length, 3)
assert.deepEqual([...doc.querySelectorAll('h2')].map(el => el.textContent.split(' · ')[0]), ['乙', '甲', '未分配负责人'])
assert.equal(doc.querySelectorAll('article').length, 4)
assert.equal(doc.querySelectorAll('script').length, 0)
assert.equal(doc.querySelector('article').textContent.includes('<script>bad()</script>'), true)
assert.equal(doc.querySelectorAll('[role="progressbar"][aria-valuenow="42"]').length, 2)
assert.equal(doc.querySelectorAll('[role="progressbar"][aria-valuenow="100"]').length, 1)
assert.equal(doc.querySelector('p').textContent, '已完成 1 / 3')
assert.match(doc.querySelector('article').textContent, /项目一/)
assert.match(doc.querySelector('article').textContent, /第一行\n第二行/)
const blocks = contentToBlocks('todo', fixture)
assert.equal(blocks.filter(b => b.type === 'heading').length, 3)
assert.equal(blocks.filter(b => b.type === 'progress').length, 4)
assert.deepEqual(blocks.filter(b => b.type === 'progress').map(b => b.percent), [42, 42, 100, 0])
assert.equal(blocks.filter(b => b.type === 'paragraph').map(b => plainOf(b.runs)).filter(text => text.includes('共同任务')).length, 2)
assert.match(todoToHtml('{"items":[]}'), /这份待办清单还没有条目/)
assert.match(todoToHtml('invalid'), /无法解析/)
console.log('PASS: 阅读分组顺序、多人任务、唯一统计、全部字段、完成进度、进度条、空清单与 HTML 转义。')
