import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Modal, message } from 'antd'
import {
  MindMap as MindMapCanvas,
  type BaseStyle,
  type MindMapApi,
  type MindNode,
  type MindNodeStyle,
  type StructureType,
} from '../mindmap-vite/src/components/MindMap'
import 'katex/dist/katex.min.css'
import { patchDoc } from '../../api/docs'
import { uploadWithDedup } from '../../lib/uploadFlow'
import { parseMindmapJSON, stringifyMindmap } from '../../lib/mindmap'
import {
  applyBaseToSnapshot,
  mindNodeToSmm,
  smmLayoutToStructure,
  smmNodeToMind,
  snapshotBase,
  snapshotThemeId,
  structureToSmmLayout,
  THEME_ID_KEY,
  type SmmNode,
} from '../../lib/mindmap.smm'
import VersionDrawer from './VersionDrawer'
import MindmapTopToolbar from './mindmap/MindmapTopToolbar'
import MindmapSideToolbar from './mindmap/MindmapSideToolbar'
import MindmapStyleCombos from './mindmap/MindmapStyleCombos'
import MindmapZoomBar from './mindmap/MindmapZoomBar'
import { type MmHandle } from './mindmap/mmShared'
import { type SaveStatus } from './SaveIndicator'

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000

/** 取树上最深的后代 id（概要默认汇总到最深一层） */
function deepestChild(node: MindNode): string {
  if (!node.children.length) return node.id
  return deepestChild(node.children[node.children.length - 1])
}

/**
 * 思维导图编辑器（mindmap-vite 方案，仿官方 Demo 浮动工具条）：
 *  - 顶部浮动工具条：回退/前进/格式刷/同级/子节点/删除/图片/超链接/备注/标签/概要/关联线/公式/外框
 *    + 样式组合（节点样式/基础样式/主题/优先级/进度/图标，复用 mindmap-vite 自带面板）+ 保存/历史/导出
 *  - 右侧浮动工具条：结构/大纲/设置
 *  - 右下缩放工具条：字体/缩小/比例/放大/适应画布/居中/复位/全屏
 *  画布数据 3s 防抖自动保存（v2 契约）+ 手动保存 + 历史版本。
 *
 * 存储侧仍写 simple-mind-map 时代的 v2 契约（root:{data,children} + layout + theme），
 * 转换全部走 lib/mindmap.smm.ts；组件只认嵌套的 MindNode。
 * 画布主题 id 与基础样式覆盖分别持久化在 theme 快照的保留键 __canvasThemeId / __baseStyle 里。
 */
export default function MindmapEditor({ docId, initialContent, title }: Props) {
  const apiRef = useRef<MindMapApi | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<MindNode | null>(null)
  const dirtyRef = useRef(false)
  const titleRef = useRef(title)
  const imageInputRef = useRef<HTMLInputElement>(null)
  /** 默认主题配置（未叠加任何自定义样式时的基准，用于主题预设干净切换与高亮匹配） */
  const defaultThemeRef = useRef<Record<string, unknown>>({})

  // 在组件顶层解析一次，用于初始化结构/主题状态（文档切换时 key 会变，整个组件会重建）
  const initialData = parseMindmapJSON(initialContent).data
  const initialTree = useMemo<MindNode>(() => smmNodeToMind(initialData.root), []) // eslint-disable-line react-hooks/exhaustive-deps
  const initialStructure = useMemo<StructureType>(() => smmLayoutToStructure(initialData.layout), []) // eslint-disable-line react-hooks/exhaustive-deps
  const initialTheme = useMemo<Record<string, unknown>>(() => initialData.theme ?? {}, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** 画布主题 id（mindmap-vite THEME_LIST 口径，持久化在主题快照保留键里） */
  const initialThemeId = useMemo<string>(() => snapshotThemeId(initialTheme) ?? 'classic-blue', []) // eslint-disable-line react-hooks/exhaustive-deps
  const initialBase = useMemo<BaseStyle>(() => snapshotBase(initialTheme), []) // eslint-disable-line react-hooks/exhaustive-deps

  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [hasActive, setHasActive] = useState(false)
  const [brushing, setBrushing] = useState(false)
  /** 关联线拾取中（已选出起点，等待终点） */
  const [assocFrom, setAssocFrom] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [fontFamily, setFontFamily] = useState('')
  const [ready, setReady] = useState(false)
  const [initFailed, setInitFailed] = useState(false)
  /** 文本输入弹窗（超链接 / 备注 / 标签 / 公式 / 概要） */
  const [prompt, setPrompt] = useState<{ kind: 'link' | 'note' | 'tag' | 'formula' | 'generalization'; value: string } | null>(null)
  // 当前结构 / 主题（持久化到 docs.content 的仍是 SMM layout / theme 口径）
  const [structure, setStructure] = useState<StructureType>(initialStructure)
  const [theme, setThemeState] = useState<Record<string, unknown>>(initialTheme)
  /** 画布主题 id 与基础样式覆盖（顶部样式组合面板的回显） */
  const [themeId, setThemeIdState] = useState<string>(initialThemeId)
  const [baseStyle, setBaseStyle] = useState<BaseStyle>(initialBase)
  /** 样式面板回显 tick：选中 / 画布数据变化时递增，驱动面板重读 api 当前值 */
  const [uiTick, setUiTick] = useState(0)
  const structureRef = useRef(structure)
  structureRef.current = structure
  const themeRef = useRef(theme)
  themeRef.current = theme

  /** 主题快照 → 组件基础样式（卸载 / 变更时同步） */
  const applyBase = useCallback((next: Record<string, unknown>) => {
    apiRef.current?.setBase(snapshotBase(next))
  }, [])

  // ---------- 画布初始化 ----------
  useEffect(() => {
    const { reset } = parseMindmapJSON(initialContent)
    if (reset) message.warning('内容格式异常，已按默认思维导图展示')
    latestRef.current = initialTree
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)
    setBrushing(false)
    setAssocFrom(null)
    setScale(1)
    setInitFailed(false)
    setReady(true)
    // 注意：这里不能把 hasActive 重置为 false —— 画布子组件挂载时会上报
    // 「默认选中根节点」（onSelectChange），父级 effect 晚于子级执行，
    // 在这里置 false 会把刚上报的选中态吞掉，导致节点级工具全部禁用
    //（根节点明明有选中框，点它自己却因 state 未变不再上报，表现为静默 no-op）。
    // 文档切换时画布 data 变化 → 组件内部 reset → 重新上报新根节点，无需手动清。

    return () => {
      // 切换文档前若有未保存内容，立即保存（fire-and-forget），避免丢节点改动
      if (dirtyRef.current && latestRef.current) {
        const tree = latestRef.current
        const themeSnapshot = themeRef.current
        void patchDoc(
          docId,
          { content: stringifyMindmap(mindNodeToSmm(tree), themeSnapshot, structureRef.current), source: 'auto' },
        ).catch(() => undefined)
        dirtyRef.current = false
      }
      if (timerRef.current) clearTimeout(timerRef.current)
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  /** 主题变化同步到画布基础样式 */
  useEffect(() => {
    if (!ready) return
    applyBase(theme)
  }, [theme, ready, applyBase])

  /** 结构变化同步到画布（结构切换后组件会自行 fit） */
  useEffect(() => {
    if (!ready) return
    apiRef.current?.setStructure(structure)
  }, [structure, ready])

  // 容器尺寸变化：面板开合 / 窗口缩放时重新适配视图（仅在未手动缩放时 fit，避免抢用户视角）
  useEffect(() => {
    const host = document.querySelector('.hk-mm-stage') as HTMLElement | null
    if (!host || typeof ResizeObserver === 'undefined') return
    let raf = 0
    let last = { w: 0, h: 0 }
    const apply = () => {
      raf = 0
      const api = apiRef.current
      if (!api) return
      const w = Math.round(host.clientWidth)
      const h = Math.round(host.clientHeight)
      if (w === last.w && h === last.h) return
      last = { w, h }
      if (api.getScale() === 1) api.fitView()
    }
    const ro = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    })
    ro.observe(host)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // 全屏切换后重新适配画布尺寸
  useEffect(() => {
    const t = setTimeout(() => {
      if (fullscreen) apiRef.current?.fitView()
    }, 150)
    return () => clearTimeout(t)
  }, [fullscreen])

  // ---------- 自动保存 ----------

  /** 防抖自动保存（节点编辑 / 主题·基础样式·字体等样式改动共用） */
  function scheduleSave() {
    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
  }

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    const tree = latestRef.current
    if (!tree) return
    setStatus('saving')
    try {
      await patchDoc(docId, { content: stringifyMindmap(mindNodeToSmm(tree), themeRef.current, structureRef.current), source })
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  /**
   * 画布数据变更：记录最新树 + 触发防抖保存。
   * 注意这里不回写组件 data 属性（组件内部已经是最新树，回写会清空撤销历史）。
   */
  const handleChange = useCallback((tree: MindNode) => {
    latestRef.current = tree
    dirtyRef.current = true
    setStatus('editing')
    setUiTick((n) => n + 1)
    scheduleSave()
  }, [])

  // ---------- 工具条基础设施 ----------

  /** 取画布句柄（未就绪时提示） */
  function requireApi(): MindMapApi | null {
    const api = apiRef.current
    if (!api) message.warning('画布尚未就绪')
    return api
  }

  // ---------- 顶部样式组合：节点样式 / 基础样式 / 主题 / 优先级 / 进度 / 图标 ----------

  /** 选中节点样式（面板色板开关语义：点选高亮项 = 取消该覆盖） */
  function handleNodeStylePatch(patch: Partial<MindNodeStyle>) {
    if (!requireApi()) return
    apiRef.current?.setNodeStyle(patch)
    scheduleSave()
  }

  /** 基础样式覆盖（整体替换语义：undefined = 清除该项，回主题默认） */
  function handleBaseStylePatch(patch: Partial<BaseStyle>) {
    const api = apiRef.current
    if (!api) return
    const next = { ...api.getBase() } as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k]
      else next[k] = v
    }
    api.setConfig({ base: next as BaseStyle })
    themeRef.current = applyBaseToSnapshot(themeRef.current, next as BaseStyle)
    setThemeState(themeRef.current)
    setBaseStyle(next as BaseStyle)
    scheduleSave()
  }

  /** 切换画布主题（干净切换：主题 id 单独持久化，基础样式覆盖一并清零） */
  function handleThemeSelect(id: string) {
    const api = apiRef.current
    if (!api) return
    api.setConfig({ themeId: id, base: {} })
    setThemeIdState(id)
    themeRef.current = { [THEME_ID_KEY]: id }
    setThemeState(themeRef.current)
    setBaseStyle({})
    scheduleSave()
    message.success('已应用主题')
  }

  function handlePriority(v: number | undefined) {
    if (!requireApi()) return
    apiRef.current?.setPriority(v)
    scheduleSave()
  }

  function handleProgress(v: number | undefined) {
    if (!requireApi()) return
    apiRef.current?.setProgress(v)
    scheduleSave()
  }

  function handleToggleIcon(id: string) {
    if (!requireApi()) return
    apiRef.current?.toggleIcon(id)
    scheduleSave()
  }

  const handle = useMemo<MmHandle>(
    () => ({
      api: apiRef.current,
      hasActive,
      selectedId: () => apiRef.current?.getSelectedId() ?? null,
      execCommand: (cmd: string, ...args: unknown[]) => {
        const api = apiRef.current
        if (!api) return
        switch (cmd) {
          case 'undo':
            api.undo()
            break
          case 'redo':
            api.redo()
            break
          case 'EXPAND_ALL':
            api.expandAll()
            break
          case 'UNEXPAND_ALL':
            api.collapseToDepth(Number(args[0]) || 2)
            break
          default:
            break
        }
      },
      setMode: (m) => {
        apiRef.current?.setMode(m)
        scheduleSave()
      },
      setWheelAction: (a) => apiRef.current?.setWheelAction(a),
      setFreeDrag: (v) => apiRef.current?.setFreeDrag(v),
      toast: (msg, kind = 'info') => {
        message[kind](msg)
      },
      scheduleSave,
    }),
    // 仅依赖 ref 与 setState，均为稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasActive, ready]
  )

  // ---------- 顶部工具条操作 ----------

  function isRootSelected(): boolean {
    const api = apiRef.current
    return !!api && api.getSelectedId() === latestRef.current?.id
  }

  const requireSelection = (): boolean => {
    if (!hasActive) {
      message.info('请先单击选中一个节点')
      return false
    }
    return true
  }

  /** 格式刷：把源节点样式暂存，选中下一个节点时套用 */
  const brushRef = useRef<MindNodeStyle | null>(null)
  function toggleBrush() {
    if (!requireApi()) return
    if (brushing) {
      brushRef.current = null
      setBrushing(false)
      message.info('已退出格式刷')
      return
    }
    if (!requireSelection()) return
    brushRef.current = apiRef.current?.getNodeStyle?.() ?? {}
    setBrushing(true)
    message.success('已复制节点样式，点击其它节点即可应用')
  }

  // 选中变化：格式刷 / 关联线拾取 在选中落地瞬间生效
  useEffect(() => {
    if (!hasActive) return
    if (brushing && brushRef.current) {
      apiRef.current?.setNodeStyle(brushRef.current)
      scheduleSave()
    }
    if (assocFrom && hasActive) {
      const api = apiRef.current
      const to = api?.getSelectedId()
      if (api && to && to !== assocFrom) {
        api.addAssocLine(assocFrom, to)
        setAssocFrom(null)
        scheduleSave()
        message.success('已生成关联线')
      }
    }
  }, [hasActive]) // eslint-disable-line react-hooks/exhaustive-deps

  function addChild() {
    if (!requireApi()) return
    if (!requireSelection()) return
    apiRef.current?.addChild()
  }

  function addSibling() {
    if (!requireApi()) return
    if (!requireSelection()) return
    if (isRootSelected()) {
      message.info('根节点没有同级节点，请使用「添加子节点」')
      return
    }
    apiRef.current?.addSibling(false)
  }

  function removeActiveNode() {
    if (!requireApi()) return
    if (!requireSelection()) return
    if (isRootSelected()) {
      message.info('根节点不可删除')
      return
    }
    apiRef.current?.removeNode()
  }

  function pickImage() {
    if (!requireApi()) return
    if (!requireSelection()) return
    imageInputRef.current?.click()
  }

  async function onImageChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!requireApi()) return
    if (!requireSelection()) return
    try {
      // 走秒传链路：节点图片重复插入时不重复传输字节（降级由 uploadFlow 内部保证）
      const up = await uploadWithDedup(file)
      apiRef.current?.setImage({ url: up.url, title: up.filename, width: 120, height: 120 })
      scheduleSave()
      message.success('图片已插入节点')
    } catch (err) {
      message.error((err as Error)?.message || '图片插入失败')
    }
  }

  /** 打开文本输入弹窗（超链接 / 备注 / 标签 / 公式 / 概要） */
  function ask(kind: 'link' | 'note' | 'tag' | 'formula' | 'generalization') {
    if (!requireApi()) return
    if (!requireSelection()) return
    const api = apiRef.current
    const current =
      kind === 'link'
        ? api?.getLink() ?? ''
        : kind === 'note'
          ? api?.getNote() ?? ''
          : kind === 'tag'
            ? (api?.getTags() ?? []).join('、')
            : kind === 'formula'
              ? api?.getFormula() ?? ''
              : ''
    setPrompt({ kind, value: current })
  }

  function confirmPrompt() {
    const api = apiRef.current
    const p = prompt
    setPrompt(null)
    if (!api || !p) return
    const value = p.value.trim()
    switch (p.kind) {
      case 'link':
        api.setLink(value)
        break
      case 'note':
        api.setNote(value)
        break
      case 'tag':
        api.setTags(
          value
            .split(/[、,，\s]+/)
            .filter(Boolean)
        )
        break
      case 'formula':
        api.setFormula(value)
        break
      case 'generalization': {
        // 概要汇总到选中节点的子树末端：画一条虚线汇总线
        const target = deepestChild(latestRef.current ?? ({} as MindNode))
        api.setGeneralization(value ? { targetId: target, text: value } : null)
        break
      }
      default:
        break
    }
    scheduleSave()
  }

  function addOuterFrame() {
    if (!requireApi()) return
    if (!requireSelection()) return
    apiRef.current?.setFrame({ color: '#2f6fed' })
    scheduleSave()
    message.info('已为选中节点及其子树添加外框')
  }

  function toggleAssociativeLine() {
    if (!requireApi()) return
    if (!requireSelection()) return
    if (assocFrom) {
      setAssocFrom(null)
      message.info('已取消关联线拾取')
      return
    }
    setAssocFrom(apiRef.current?.getSelectedId() ?? null)
    message.info('再点击另一个节点即可生成关联线')
  }

  function centerRoot() {
    requireApi()?.centerRoot()
  }

  function zoomIn() {
    requireApi()?.zoomIn()
  }

  function zoomOut() {
    requireApi()?.zoomOut()
  }

  function resetZoom() {
    requireApi()?.resetView()
  }

  function fitCanvas() {
    requireApi()?.fitView()
  }

  /** 全局字体（右下缩放条）：走基础样式覆盖通道，空串 = 恢复默认字体 */
  function applyFont(family: string) {
    setFontFamily(family)
    handleBaseStylePatch(family ? { fontFamily: family } : { fontFamily: undefined })
  }

  function exportPng() {
    if (!requireApi()) return
    try {
      apiRef.current?.exportPng()
    } catch {
      message.error('导出失败，请重试')
    }
  }

  /** 从当前导图数据生成缩进大纲文本 */
  const getOutline = useCallback(() => {
    const root = latestRef.current
    if (!root) return ''
    const lines: string[] = []
    const walk = (n: MindNode, depth: number) => {
      lines.push(`${'    '.repeat(depth)}${depth > 0 ? '- ' : '# '}${n.title || '（无标题）'}`)
      for (const c of n.children ?? []) walk(c, depth + 1)
    }
    walk(root, 0)
    return lines.join('\n')
  }, [])

  const promptTitle: Record<string, string> = {
    link: '设置超链接',
    note: '节点备注',
    tag: '节点标签（多个用顿号或逗号分隔）',
    formula: 'LaTeX 公式（不含 $ 定界符）',
    generalization: '概要文本（汇总到子树末端）',
  }

  return (
    <div
      style={
        fullscreen
          ? { position: 'fixed', inset: 0, zIndex: 1000, background: '#fff', display: 'flex', flexDirection: 'column' }
          : { height: '100%', display: 'flex', flexDirection: 'column' }
      }
    >
      {/* 画布与浮动工具条同层容器（工具条绝对定位在画布之上，不占布局高度） */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#fbfbfc', overflow: 'hidden' }}>
        {/* 画布宿主：类名为 ResizeObserver 提供尺寸观测锚点 */}
        <div className="hk-mm-stage" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <MindMapCanvas
            ref={apiRef}
            data={initialTree}
            editable
            showToolbar={false}
            fitOnMount
            defaultConfig={{
              structure: initialStructure,
              themeId: initialThemeId,
              lineStyle: 'curve',
              base: initialBase,
            }}
            onChange={handleChange}
            onScaleChange={setScale}
            onSelectChange={(id) => {
              setHasActive(!!id)
              setUiTick((n) => n + 1)
            }}
          />
        </div>

        {/* 画布初始化降级态（容器尺寸异常时不再整页白屏，给出可恢复入口） */}
        {initFailed && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#fbfbfc',
              zIndex: 5,
            }}
          >
            <Empty description="画布初始化失败（容器尺寸异常）">
              <Button type="primary" onClick={() => window.location.reload()}>
                刷新重试
              </Button>
            </Empty>
          </div>
        )}

        <MindmapTopToolbar
          status={status}
          savedAt={savedAt}
          brushing={brushing}
          hasActive={hasActive}
          onBack={() => handle.execCommand('undo')}
          onForward={() => handle.execCommand('redo')}
          onToggleBrush={toggleBrush}
          onAddSibling={addSibling}
          onAddChild={addChild}
          onRemoveNode={removeActiveNode}
          onPickImage={pickImage}
          onHyperlink={() => ask('link')}
          onNote={() => ask('note')}
          onTag={() => ask('tag')}
          onGeneralization={() => ask('generalization')}
          onAssociativeLine={toggleAssociativeLine}
          onFormula={() => ask('formula')}
          onOuterFrame={addOuterFrame}
          onSave={() => void doSave('manual')}
          onOpenVersions={() => setVersionOpen(true)}
          onExportPng={() => exportPng()}
          styleCombos={
            <MindmapStyleCombos
              api={apiRef.current}
              hasActive={hasActive}
              tick={uiTick}
              themeId={themeId}
              base={baseStyle}
              onNodeStyle={handleNodeStylePatch}
              onBaseStyle={handleBaseStylePatch}
              onThemeId={handleThemeSelect}
              onPriority={handlePriority}
              onProgress={handleProgress}
              onToggleIcon={handleToggleIcon}
            />
          }
        />

        <MindmapSideToolbar
          handle={handle}
          getOutline={getOutline}
          onPanelToggle={() => undefined}
          layout={structureToSmmLayout(structure)}
          onLayoutChange={(next) => {
            setStructure(smmLayoutToStructure(next))
            scheduleSave()
          }}
        />

        <MindmapZoomBar
          handle={handle}
          scale={scale}
          fullscreen={fullscreen}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={resetZoom}
          onFit={fitCanvas}
          onCenterRoot={centerRoot}
          onToggleFullscreen={() => setFullscreen((v) => !v)}
          onFontChange={applyFont}
          fontFamily={fontFamily}
        />

        {/* 图片插入用隐藏文件选择器 */}
        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(e) => void onImageChosen(e)} />
      </div>

      <Modal
        open={!!prompt}
        title={prompt ? promptTitle[prompt.kind] : ''}
        okText="确定"
        cancelText="取消"
        onOk={confirmPrompt}
        onCancel={() => setPrompt(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          value={prompt?.value ?? ''}
          onChange={(e) => setPrompt((p) => (p ? { ...p, value: e.target.value } : p))}
          onPressEnter={confirmPrompt}
        />
      </Modal>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType="mindmap"
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => window.location.reload()}
      />
    </div>
  )
}

// 让 SmmNode 类型在文件内被引用（存储契约的唯一入口在 lib/mindmap.ts）
export type { SmmNode }
