// 生成内置模板用的思维导图主题快照（完整 opt.themeConfig）。
//
// 背景：simple-mind-map 的 setThemeConfig(config) 是「整份替换」语义，只存片段会导致
// 其余主题键丢失（节点内边距、连线样式等全变 undefined）。因此模板里必须落**完整快照**。
// 本脚本以库自带的 src/theme/default.js 为基准，深合并各色卡补丁后输出：
//     tools/templates/mindmap-themes.json     { 色卡名: 完整主题配置 }
// 同一份色卡补丁同时写进 web/src/components/editor/mindmap/mmShared.ts 的 MM_THEME_PRESETS
// （编辑器主题面板），两边合并基准一致 → 打开模板生成的脑图时主题预设能正确高亮。
//
// 用法：cd web && node ../tools/templates/gen-mindmap-themes.mjs
//      （需 web/node_modules 已安装 simple-mind-map）

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import defaultTheme from '../../web/node_modules/simple-mind-map/src/theme/default.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 浅递归合并（与前端 deepMerge 同语义：普通对象逐键合并，其余直接替换） */
function deepMerge(base, patch) {
  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!isPlain(base) || !isPlain(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlain(out[k]) && isPlain(v) ? deepMerge(out[k], v) : v
  }
  return out
}

/** 三层节点色（与 mmShared 的 level() 一致） */
const level = (color, fillColor, borderColor) => ({ color, fillColor, borderColor })

// 通用排版：白底画布 + 2px 曲线连线 + 层级字号收敛
const base = {
  backgroundColor: '#ffffff',
  lineStyle: 'curve',
  lineWidth: 2,
  rootLineKeepSameInCurve: true,
  root: {
    fontSize: 17,
    fontWeight: 'bold',
    borderRadius: 10,
    borderWidth: 0,
    paddingX: 20,
    paddingY: 10,
  },
  second: {
    fontSize: 15,
    fontWeight: 'bold',
    borderRadius: 8,
    borderWidth: 1,
    paddingX: 14,
    paddingY: 8,
    marginX: 80,
  },
  node: {
    fontSize: 14,
    fontWeight: 'normal',
    borderWidth: 0,
    paddingX: 4,
    paddingY: 2,
  },
  generalization: { borderRadius: 8, borderWidth: 1 },
}

// 四套色卡：层次色（根 / 一级 / 二三级）+ 连线色，色相彼此拉开，且不与内置 ocean/forest 重合
export const MM_PALETTES = {
  ink: {
    label: '墨蓝',
    preview: ['#24436b', '#ecf2fa', '#a9c2e2'],
    theme: {
      lineColor: '#a9c2e2',
      root: level('#ffffff', '#24436b', '#24436b'),
      second: level('#1b3556', '#ecf2fa', '#a9c2e2'),
      node: level('#44586f', 'transparent', 'transparent'),
    },
  },
  jade: {
    label: '青玉',
    preview: ['#0f6b52', '#e6f5f0', '#94d0bd'],
    theme: {
      lineColor: '#94d0bd',
      root: level('#ffffff', '#0f6b52', '#0f6b52'),
      second: level('#0c5340', '#e6f5f0', '#94d0bd'),
      node: level('#3d6157', 'transparent', 'transparent'),
    },
  },
  rose: {
    label: '绛玫',
    preview: ['#a8325c', '#fdeef3', '#e9aec2'],
    theme: {
      lineColor: '#e9aec2',
      root: level('#ffffff', '#a8325c', '#a8325c'),
      second: level('#7d2344', '#fdeef3', '#e9aec2'),
      node: level('#6b4a56', 'transparent', 'transparent'),
    },
  },
  slate: {
    label: '石墨',
    preview: ['#39404e', '#eef1f5', '#b8c0cc'],
    theme: {
      lineColor: '#b8c0cc',
      root: level('#ffffff', '#39404e', '#39404e'),
      second: level('#2b3240', '#eef1f5', '#b8c0cc'),
      node: level('#4c5563', 'transparent', 'transparent'),
    },
  },
}

const out = {}
for (const [key, p] of Object.entries(MM_PALETTES)) {
  out[key] = deepMerge(deepMerge(defaultTheme, base), p.theme)
}

const target = join(HERE, 'mindmap-themes.json')
writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`[themes] 已写出 ${Object.keys(out).length} 套色卡 → ${target}`)
for (const [k, v] of Object.entries(out)) {
  console.log(`         ${k}(${MM_PALETTES[k].label}) 共 ${Object.keys(v).length} 个主题键`)
}

// ── 同步生成编辑器主题面板用的预设补丁 ──────────────────────────────────────
// 编辑器应用预设的方式是 deepMerge(默认主题, preset.theme)，与上面的模板快照合并基准一致；
// 因此 preset.theme 必须等于 deepMerge(通用排版, 色卡) —— 这样打开模板生成的脑图时，
// matchThemeKey 能精确匹配并高亮对应预设色卡。
const tsLines = []
for (const [key, p] of Object.entries(MM_PALETTES)) {
  const patch = deepMerge(base, p.theme)
  tsLines.push(
    `  {\n` +
      `    key: '${key}',\n` +
      `    label: '${p.label}',\n` +
      `    preview: ${JSON.stringify(p.preview)},\n` +
      `    theme: ${JSON.stringify(patch, null, 2).split('\n').join('\n    ')},\n` +
      `  },`,
  )
}
const ts = `// 由 tools/templates/gen-mindmap-themes.mjs 生成，请勿手改。
// 重新生成：cd web && node ../tools/templates/gen-mindmap-themes.mjs
//
// 这 4 套色卡与内置文档模板（server/internal/repository/templates/*.json 的 mindmap 条目）
// 使用同一份主题快照，保证「模板生成的脑图」在编辑器里能高亮出对应预设。

export interface MmExtraThemePreset {
  key: string
  label: string
  preview: [string, string, string]
  theme: Record<string, unknown>
}

export const MM_EXTRA_THEME_PRESETS: MmExtraThemePreset[] = [
${tsLines.join('\n')}
]
`
const tsTarget = join(HERE, '..', '..', 'web', 'src', 'components', 'editor', 'mindmap', 'mmThemePresets.generated.ts')
writeFileSync(tsTarget, ts, 'utf8')
console.log(`[themes] 已写出编辑器预设补丁 → ${tsTarget}`)
