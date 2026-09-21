import {
  convertBlock,
  convertLine,
  detectBlockRange,
  replaceLine,
} from '../../web/src/lib/notionBlocks'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}\n      got=${g}\n     want=${w}`)
  }
}
function noLiteral(name: string, s: string) {
  const bad = ['正文', '标题', '列表项', '引用内容', '提示内容'].filter((w) => s.includes(w))
  if (bad.length === 0) {
    pass++
    console.log(`  ok  ${name} (无占位字样)`)
  } else {
    fail++
    console.log(`FAIL  ${name} 含占位字样: ${bad.join(',')} -> ${JSON.stringify(s)}`)
  }
}

// ===== BUG 3：空行转换不应写入「正文 / 标题」等字面文字 =====
// 空段落 -> 正文
eq('空段落 转 正文', convertBlock([''], detectBlockRange([''], 0), 'paragraph'), [''])
// 空行 -> 标题2 应为 '## '（合法空标题），不是 '## 标题'
eq('空行 转 标题2', convertBlock([''], detectBlockRange([''], 0), 'h2'), ['## '])
noLiteral('空行 转 标题2 无字面', convertBlock([''], detectBlockRange([''], 0), 'h2')[0])
// 非空标题
eq('标题 转 标题2(保留文字)', convertBlock(['# 旧标题'], detectBlockRange(['# 旧标题'], 0), 'h2'), ['## 旧标题'])
// 空行 -> 无序列表
eq('空行 转 无序列表', convertBlock([''], detectBlockRange([''], 0), 'ul'), ['- '])
// 空行 -> 有序列表
eq('空行 转 有序列表', convertBlock([''], detectBlockRange([''], 0), 'ol'), ['1. '])
// 空行 -> 待办
eq('空行 转 待办', convertBlock([''], detectBlockRange([''], 0), 'task'), ['- [ ] '])
// 空行 -> 引用
eq('空行 转 引用', convertBlock([''], detectBlockRange([''], 0), 'quote'), ['> '])
// 空行 -> 高亮块（callout）只留前缀
eq('空行 转 高亮块', convertBlock([''], detectBlockRange([''], 0), 'callout'), ['> 💡 '])

// ===== convertLine（/ 快捷菜单路径）同样不应写入字面文字 =====
eq('convertLine 空 转 标题2', convertLine('', 'h2'), '## ')
noLiteral('convertLine 空 转 标题2 无字面', convertLine('', 'h2'))
eq('convertLine 空 转 正文', convertLine('', 'paragraph'), '')
eq('convertLine 空 转 无序列表', convertLine('', 'ul'), '- ')
eq('convertLine 非空 转 标题3', convertLine('hello', 'h3'), '### hello')

// ===== 多行块转换：代码块 -> 标题 提取正文 =====
const code = ['```', 'const a = 1', '```']
eq('代码块 转 标题1', convertBlock(code, detectBlockRange(code, 0), 'h1'), ['# const a = 1'])

// ===== 标题 -> 正文 应去掉 # 前缀 =====
eq('标题 转 正文', convertBlock(['## 某某'], detectBlockRange(['## 某某'], 0), 'paragraph'), ['某某'])

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
