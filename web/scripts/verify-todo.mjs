import assert from 'node:assert/strict'
import { build } from 'esbuild'
const output = await build({ entryPoints: ['src/lib/todo.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const todo = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
const sample = `斌辉：
1、12类优惠（完成）
整单折扣、菜金折扣、会员折扣、抹零、免单、折扣券、代金券、菜品券、抖音套餐券、抖音代金券、线下菜品券、线下代金券
2、厦门IOI停车场（完成）；
3、财务报表（排后面做）

星恩：
1、供应链后端优化（进行中）；
2、打印设备提供被扫功能（下周开始）

松鸿：
1、供就链前端UI优化（进行中）；
2、小程序打印机激活/绑定（进行中）；
3、小程序深圳5项活动（完成，待设计提供素材）；
4、排队小程序增加请求头和定位逻辑改造

永伟：
1、配合宗良修改点餐订单BUG（完成）；
2、与斌辉对接线下券（完成，寄海券可用，不包含抖音美团券）；
3、与张闳对接优化点餐购物车（进行中）

宗良：跟进测试（每周五出测试报告进度表）`
const items = todo.importTodoText(sample)
assert.equal(items.length, 13)
assert.equal(items.filter(it => it.done).length, 5)
assert.equal(todo.groupTodos(items).length, 5)
assert.match(items[0].note, /线下代金券/)
assert.equal(items[7].text, '小程序深圳5项活动')
assert.equal(items[7].progress, 100)
assert.match(items[10].note, /不包含抖音美团券/)
assert.equal(items[12].text, '跟进测试')
assert.deepEqual(items[12].assignees, ['宗良'])
const old = todo.parseTodoJSON('{"items":[{"text":"旧任务","done":true}]}').data.items[0]
assert.equal(old.progress, 100)
assert.deepEqual(old.assignees, [])
assert.equal(old.project, '')
const edited = { ...todo.emptyItem('多人任务'), assignees: ['甲', '乙'], project: '项目一', progress: 33 }
assert.equal(todo.groupTodos([edited]).length, 2)
assert.equal(todo.patchTodoItem(edited, { done: true }).progress, 100)
assert.equal(todo.patchTodoItem(old, { done: false }).progress, 0)
assert.equal(todo.patchTodoItem(old, { progress: 45 }).done, false)
assert.equal(todo.patchTodoItem(edited, { progress: 200 }).progress, 100)
assert.deepEqual(todo.parseTodoJSON(todo.stringifyTodo({ version: 1, items: [edited] })).data.items[0], edited)
assert.equal(todo.importTodoText('甲、乙：\n1. 实施（进行中 65%）')[0].progress, 65)
assert.equal(todo.importTodoText('甲：\n1、任务（未完成）')[0].done, false)
assert.equal(todo.importTodoText(' \n ').length, 0)
console.log('待办验证通过：示例 13 项、5 项完成；兼容旧数据、多人分组、进度联动、序列化。')

const source = { version: 1, items: [edited, { ...todo.emptyItem('已完成任务'), done: true, progress: 100, note: '保留备注', due: '2026-10-23', priority: 'high' }] }
const copy = JSON.parse(todo.cloneTodoContent(JSON.stringify(source)))
assert.equal(copy.items.length, source.items.length)
for (let i = 0; i < source.items.length; i++) {
  assert.notEqual(copy.items[i].id, source.items[i].id)
  assert.deepEqual({ ...copy.items[i], id: source.items[i].id }, source.items[i])
}
copy.items[0].text = '修改副本'
assert.equal(source.items[0].text, '多人任务')
assert.throws(() => todo.cloneTodoContent('{broken json'))
console.log('待办复制验证通过：条目独立 ID，全部字段保留，修改副本不影响源数据，异常内容拒绝复制。')
