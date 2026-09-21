// 由 tools/templates/gen-mindmap-themes.mjs 生成，请勿手改。
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
  {
    key: 'ink',
    label: '墨蓝',
    preview: ["#24436b","#ecf2fa","#a9c2e2"],
    theme: {
      "backgroundColor": "#ffffff",
      "lineStyle": "curve",
      "lineWidth": 2,
      "rootLineKeepSameInCurve": true,
      "root": {
        "fontSize": 17,
        "fontWeight": "bold",
        "borderRadius": 10,
        "borderWidth": 0,
        "paddingX": 20,
        "paddingY": 10,
        "color": "#ffffff",
        "fillColor": "#24436b",
        "borderColor": "#24436b"
      },
      "second": {
        "fontSize": 15,
        "fontWeight": "bold",
        "borderRadius": 8,
        "borderWidth": 1,
        "paddingX": 14,
        "paddingY": 8,
        "marginX": 80,
        "color": "#1b3556",
        "fillColor": "#ecf2fa",
        "borderColor": "#a9c2e2"
      },
      "node": {
        "fontSize": 14,
        "fontWeight": "normal",
        "borderWidth": 0,
        "paddingX": 4,
        "paddingY": 2,
        "color": "#44586f",
        "fillColor": "transparent",
        "borderColor": "transparent"
      },
      "generalization": {
        "borderRadius": 8,
        "borderWidth": 1
      },
      "lineColor": "#a9c2e2"
    },
  },
  {
    key: 'jade',
    label: '青玉',
    preview: ["#0f6b52","#e6f5f0","#94d0bd"],
    theme: {
      "backgroundColor": "#ffffff",
      "lineStyle": "curve",
      "lineWidth": 2,
      "rootLineKeepSameInCurve": true,
      "root": {
        "fontSize": 17,
        "fontWeight": "bold",
        "borderRadius": 10,
        "borderWidth": 0,
        "paddingX": 20,
        "paddingY": 10,
        "color": "#ffffff",
        "fillColor": "#0f6b52",
        "borderColor": "#0f6b52"
      },
      "second": {
        "fontSize": 15,
        "fontWeight": "bold",
        "borderRadius": 8,
        "borderWidth": 1,
        "paddingX": 14,
        "paddingY": 8,
        "marginX": 80,
        "color": "#0c5340",
        "fillColor": "#e6f5f0",
        "borderColor": "#94d0bd"
      },
      "node": {
        "fontSize": 14,
        "fontWeight": "normal",
        "borderWidth": 0,
        "paddingX": 4,
        "paddingY": 2,
        "color": "#3d6157",
        "fillColor": "transparent",
        "borderColor": "transparent"
      },
      "generalization": {
        "borderRadius": 8,
        "borderWidth": 1
      },
      "lineColor": "#94d0bd"
    },
  },
  {
    key: 'rose',
    label: '绛玫',
    preview: ["#a8325c","#fdeef3","#e9aec2"],
    theme: {
      "backgroundColor": "#ffffff",
      "lineStyle": "curve",
      "lineWidth": 2,
      "rootLineKeepSameInCurve": true,
      "root": {
        "fontSize": 17,
        "fontWeight": "bold",
        "borderRadius": 10,
        "borderWidth": 0,
        "paddingX": 20,
        "paddingY": 10,
        "color": "#ffffff",
        "fillColor": "#a8325c",
        "borderColor": "#a8325c"
      },
      "second": {
        "fontSize": 15,
        "fontWeight": "bold",
        "borderRadius": 8,
        "borderWidth": 1,
        "paddingX": 14,
        "paddingY": 8,
        "marginX": 80,
        "color": "#7d2344",
        "fillColor": "#fdeef3",
        "borderColor": "#e9aec2"
      },
      "node": {
        "fontSize": 14,
        "fontWeight": "normal",
        "borderWidth": 0,
        "paddingX": 4,
        "paddingY": 2,
        "color": "#6b4a56",
        "fillColor": "transparent",
        "borderColor": "transparent"
      },
      "generalization": {
        "borderRadius": 8,
        "borderWidth": 1
      },
      "lineColor": "#e9aec2"
    },
  },
  {
    key: 'slate',
    label: '石墨',
    preview: ["#39404e","#eef1f5","#b8c0cc"],
    theme: {
      "backgroundColor": "#ffffff",
      "lineStyle": "curve",
      "lineWidth": 2,
      "rootLineKeepSameInCurve": true,
      "root": {
        "fontSize": 17,
        "fontWeight": "bold",
        "borderRadius": 10,
        "borderWidth": 0,
        "paddingX": 20,
        "paddingY": 10,
        "color": "#ffffff",
        "fillColor": "#39404e",
        "borderColor": "#39404e"
      },
      "second": {
        "fontSize": 15,
        "fontWeight": "bold",
        "borderRadius": 8,
        "borderWidth": 1,
        "paddingX": 14,
        "paddingY": 8,
        "marginX": 80,
        "color": "#2b3240",
        "fillColor": "#eef1f5",
        "borderColor": "#b8c0cc"
      },
      "node": {
        "fontSize": 14,
        "fontWeight": "normal",
        "borderWidth": 0,
        "paddingX": 4,
        "paddingY": 2,
        "color": "#4c5563",
        "fillColor": "transparent",
        "borderColor": "transparent"
      },
      "generalization": {
        "borderRadius": 8,
        "borderWidth": 1
      },
      "lineColor": "#b8c0cc"
    },
  },
]
