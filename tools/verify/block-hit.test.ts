import { blockIndexAtPoint } from '../../web/src/lib/irDom'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}\n      got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  }
}

// 用桩对象模拟顶层块（每个块宽 600、高 24，竖直排列，块间有 8px 间隙）
function block(top: number, left = 100, width = 600, height = 24): { getBoundingClientRect: () => any } {
  return {
    getBoundingClientRect: () => ({ top, bottom: top + height, left, right: left + width }),
  }
}
const blocks = [block(100), block(132), block(164), block(196)]
const GUTTER = 50

// —— BUG 1：鼠标在块左侧留白带内（x < 块左缘）也应命中该块（旧 elementFromPoint 逻辑会失败）——
// 光标在「第 2 块」(top 132) 正上方，但横向在块左缘左侧 30px（gutter 内）
eq('BUG1 留白带内命中第2块', blockIndexAtPoint(blocks, 100 - 30, 140, GUTTER), 1)
// 横向在块左缘左侧 49px（仍 ≤ gutter）命中
eq('BUG1 gutter 边界(49px)命中', blockIndexAtPoint(blocks, 100 - 49, 140, GUTTER), 1)
// 横向超出 gutter（左侧 60px）不命中
eq('BUG1 超出gutter不命中', blockIndexAtPoint(blocks, 100 - 60, 140, GUTTER), -1)
// 横向在块正文内命中
eq('块正文内命中第2块', blockIndexAtPoint(blocks, 300, 140, GUTTER), 1)

// —— BUG 2：纵向锁定正确块（不会命中相邻块）——
// 光标 y 恰好在第 3 块中部
eq('BUG2 第3块中部', blockIndexAtPoint(blocks, 300, 176, GUTTER), 2)
// 光标在块间 8px 间隙：偏下（y=162，更靠近第3块）应落第3块；偏上（y=158）落第2块
eq('BUG2 块间间隙落第3块(偏下)', blockIndexAtPoint(blocks, 300, 162, GUTTER), 2)
eq('BUG2 块间间隙落第2块(偏上)', blockIndexAtPoint(blocks, 300, 158, GUTTER), 1)
// 光标在第一个块上方很远（y < top-16）不命中
eq('第一个块上方很远不命中', blockIndexAtPoint(blocks, 300, 50, GUTTER), -1)
// 光标紧贴第一个块上方（10px，≤容差）仍命中第1块（自然贴合首行）
eq('首块上方容差内命中', blockIndexAtPoint(blocks, 300, 90, GUTTER), 0)
// 光标在最后一个块下方很远不命中
eq('末尾空白区不命中', blockIndexAtPoint(blocks, 300, 400, GUTTER), -1)

// —— 横向在块右缘之外不命中 ——
eq('块右侧外不命中', blockIndexAtPoint(blocks, 100 + 600 + 20, 140, GUTTER), -1)

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
