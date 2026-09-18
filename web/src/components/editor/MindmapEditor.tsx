import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, message } from 'antd'
import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import Painter from 'simple-mind-map/src/plugins/Painter.js'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import Formula from 'simple-mind-map/src/plugins/Formula.js'
import 'katex/dist/katex.min.css'
import { patchDoc } from '../../api/docs'
import { uploadFile } from '../../api/uploads'
import { parseMindmapJSON, stringifyMindmap, type SmmNode } from '../../lib/mindmap'
import VersionDrawer from './VersionDrawer'
import MindmapTopToolbar from './mindmap/MindmapTopToolbar'
import MindmapSideToolbar from './mindmap/MindmapSideToolbar'
import MindmapZoomBar from './mindmap/MindmapZoomBar'
import type { MmHandle, MmNodeLike, MmPainter } from './mindmap/mmShared'
import { type SaveStatus } from './SaveIndicator'

// 插件静态注册（模块级一次即可，所有实例共享）
MindMap.usePlugin(Drag) // 节点拖拽调整层级
MindMap.usePlugin(Export) // export('png'|'svg'|...)
MindMap.usePlugin(Painter) // 格式刷
MindMap.usePlugin(AssociativeLine) // 关联线
MindMap.usePlugin(OuterFrame) // 外框
MindMap.usePlugin(Formula) // 公式（katex）

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000

/** 节点实例（simple-mind-map 未暴露类型，仅取用到的属性） */
interface SmmNodeInstance extends MmNodeLike {
  isRoot?: boolean
  getData?(): { text?: string; style?: Record<string, unknown> }
}

/** 大纲递归所需的最小结构 */
interface OutlineNode {
  data?: { text?: string }
  children?: OutlineNode[]
}

/**
 * 思维导图编辑器（simple-mind-map 方案，仿官方 Demo 三处浮动工具条）：
 *  - 顶部浮动工具条：回退/前进/格式刷/同级/子节点/删除/图片/超链接/备注/标签/概要/关联线/公式/外框 + 保存/历史/导出
 *  - 右侧浮动工具条：节点样式/基础样式/主题/结构/大纲/设置
 *  - 右下缩放工具条：字体/缩小/比例/放大/适应画布/居中/复位/全屏
 *  画布数据 3s 防抖自动保存（v2 契约）+ 手动保存 + 历史版本。
 */
export default function MindmapEditor({ docId, initialContent, title }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mindMapRef = useRef<MindMap | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<SmmNode | null>(null)
  const dirtyRef = useRef(false)
  const titleRef = useRef(title)
  const baseThemeRef = useRef<Record<string, unknown>>({})
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [hasActive, setHasActive] = useState(false)
  const [brushing, setBrushing] = useState(false)
  const [scale, setScale] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [fontFamily, setFontFamily] = useState('')
  const [ready, setReady] = useState(false)
  const [initFailed, setInitFailed] = useState(false)

  /**
   * 抖动治理用的两个闸门（见下方 ResizeObserver）：
   *   · suppressUntilRef：右侧面板开合/滑入滑出期间直接忽略尺寸变化；
   *   · lastSizeRef：只在宽高真的变化（>1px）时才 resize，切断
   *     「resize → render → 再触发 resize」的自激回路。
   */
  const suppressUntilRef = useRef(0)
  const lastSizeRef = useRef({ w: 0, h: 0 })
  /** 面板开合期间完全跳过画布 resize（抽屉滑入/滑出每帧都在改布局） */
  const onPanelToggle = useCallback(() => {
    suppressUntilRef.current = Date.now() + 500
  }, [])

  titleRef.current = title

  // ---------- 画布初始化 ----------

  useEffect(() => {
    const host = elRef.current
    if (!host) return

    const { data, reset } = parseMindmapJSON(initialContent)
    if (reset) message.warning('内容格式异常，已重置默认思维导图')
    latestRef.current = data.root
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)
    setHasActive(false)
    setBrushing(false)
    setScale(1)
    setInitFailed(false)

    let mm: MindMap | null = null
    let cancelled = false
    let raf = 0
    let attempts = 0

    /**
     * 构造画布。simple-mind-map 在容器宽高为 0 时会直接抛错，
     * 而 effect 内抛错会让 React 卸载整棵树（整页白屏），
     * 因此这里对「尺寸尚未就绪」做下一帧重试，并在持续失败时降级为可恢复的提示态。
     */
    const create = () => {
      if (cancelled) return
      try {
        mm = new MindMap({
          el: host,
          data: data.root,
          layout: 'logicalStructure',
          initRootNodePosition: ['center', 'center'],
          enableAutoEnterTextEditWhenKeydown: true,
          mousewheelAction: 'zoom',
        })
      } catch {
        if (attempts++ < 20) {
          raf = requestAnimationFrame(create)
          return
        }
        setInitFailed(true)
        message.error('画布初始化失败：容器尺寸异常，请刷新页面重试')
        return
      }
      mindMapRef.current = mm
      // 记录初始尺寸：ResizeObserver 首次回调（0 → N）不该被当成「真实变化」而触发一次 render
      const r0 = host.getBoundingClientRect()
      lastSizeRef.current = { w: Math.round(r0.width), h: Math.round(r0.height) }
      // 初始主题快照：主题/基础样式面板以其为基准做覆盖
      try {
        baseThemeRef.current = JSON.parse(JSON.stringify(mm.getTheme() ?? {}))
      } catch {
        baseThemeRef.current = {}
      }
      setReady(true)

      mm.on('data_change', (d: SmmNode) => {
        latestRef.current = d
        dirtyRef.current = true
        setStatus('editing')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
      })
      mm.on('node_active', (_node: unknown, activeNodeList: unknown[]) => {
        setHasActive(activeNodeList.length > 0)
      })
      mm.on('scale', (s: number) => setScale(s))
      mm.on('painter_start', () => setBrushing(true))
      mm.on('painter_end', () => setBrushing(false))
    }
    create()

    return () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current && latestRef.current) {
        void patchDoc(docId, { content: stringifyMindmap(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
      mindMapRef.current = null
      setReady(false)
      try {
        mm?.destroy()
      } catch {
        /* 重复销毁等场景忽略 */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  // 容器尺寸变化（左栏折叠/调宽、窗口缩放）时同步画布。
  //
  // 这里是「点击右侧工具条后画布剧烈抖动」的根因所在，三重防护：
  //   1) **阈值判定**：simple-mind-map 的 resize() 在宽高变化时立刻 render()（整树重排 + 重绘），
  //      而重绘又会让 ResizeObserver 再次回调 —— 形成自激回路。这里记录上次生效尺寸，
  //      只有变化超过 1px 才真正 resize，回路在第一圈就被切断。
  //   2) **抑制窗口**：右侧面板（antd Drawer 内联渲染在画布容器内）开合与滑入滑出动画期间
  //      浏览器连续 reflow，这段时间内一律不 resize，动画结束后再补一次。
  //   3) **rAF 节流**：同一帧内多次回调只处理最后一次。
  useEffect(() => {
    const host = elRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const apply = () => {
      raf = 0
      const mm = mindMapRef.current
      if (!mm) return
      const rect = host.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      // 抑制窗口内只登记尺寸，不触发 render（动画结束后会自然再回调一次）
      if (Date.now() < suppressUntilRef.current) {
        lastSizeRef.current = { w, h }
        return
      }
      const last = lastSizeRef.current
      if (w > 0 && h > 0 && Math.abs(w - last.w) <= 1 && Math.abs(h - last.h) <= 1) return
      lastSizeRef.current = { w, h }
      try {
        mm.resize()
      } catch {
        /* 销毁瞬间忽略 */
      }
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
      const mm = mindMapRef.current
      if (!mm) return
      const host = elRef.current
      if (host) {
        const rect = host.getBoundingClientRect()
        lastSizeRef.current = { w: Math.round(rect.width), h: Math.round(rect.height) }
      }
      try {
        mm.resize()
      } catch {
        /* 忽略 */
      }
    }, 150)
    return () => clearTimeout(t)
  }, [fullscreen])

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    const root = latestRef.current
    if (!root) return
    setStatus('saving')
    try {
      await patchDoc(docId, { content: stringifyMindmap(root), source })
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  // ---------- 工具条基础设施 ----------

  function requireMindMap(): MindMap | null {
    const mm = mindMapRef.current
    if (!mm) message.warning('画布尚未就绪')
    return mm
  }

  /** 取当前激活节点实例（无激活节点时提示） */
  function requireActiveNode(mm: MindMap): SmmNodeInstance | null {
    const list = (mm.renderer as unknown as { activeNodeList: SmmNodeInstance[] }).activeNodeList
    const node = list.length > 0 ? list[list.length - 1] : null
    if (!node) message.info('请先单击选中一个节点')
    return node
  }

  /** 供浮动工具条使用的句柄（含激活节点判定与提示出口） */
  const handle = useMemo<MmHandle>(
    () => ({
      get mm() {
        return mindMapRef.current
      },
      hasActive,
      activeNode: () => {
        const mm = mindMapRef.current
        if (!mm) return null
        return requireActiveNode(mm)
      },
      requireMm: () => requireMindMap(),
      toast: (msg, kind = 'info') => {
        message[kind](msg)
      },
      baseTheme: () => baseThemeRef.current,
    }),
    // requireActiveNode / requireMindMap / doSave 均为稳定引用或仅依赖 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasActive, ready],
  )

  // ---------- 顶部工具条操作 ----------

  function goBack() {
    requireMindMap()?.execCommand('BACK')
  }

  function goForward() {
    requireMindMap()?.execCommand('FORWARD')
  }

  /** 格式刷：开始/结束由 Painter 插件管理，状态通过 painter_start/end 事件回填 */
  function toggleBrush() {
    const mm = requireMindMap()
    if (!mm) return
    const painter = (mm as unknown as { painter?: MmPainter }).painter
    if (!painter) {
      message.warning('格式刷插件未就绪')
      return
    }
    if (brushing) {
      painter.endPainter?.()
      setBrushing(false)
      message.info('已退出格式刷')
      return
    }
    if (!requireActiveNode(mm)) return
    painter.startPainter?.()
    message.success('已复制节点样式，点击其它节点即可应用')
  }

  function addChild() {
    const mm = requireMindMap()
    if (!mm) return
    if (!requireActiveNode(mm)) return
    mm.execCommand('INSERT_CHILD_NODE')
  }

  function addSibling() {
    const mm = requireMindMap()
    if (!mm) return
    const node = requireActiveNode(mm)
    if (!node) return
    if (node.isRoot) {
      message.info('根节点没有同级节点，请使用「添加子节点」')
      return
    }
    mm.execCommand('INSERT_NODE')
  }

  function removeActiveNode() {
    const mm = requireMindMap()
    if (!mm) return
    const node = requireActiveNode(mm)
    if (!node) return
    if (node.isRoot) {
      message.info('根节点不可删除')
      return
    }
    mm.execCommand('REMOVE_NODE')
  }

  function pickImage() {
    const mm = requireMindMap()
    if (!mm) return
    if (!requireActiveNode(mm)) return
    imageInputRef.current?.click()
  }

  async function onImageChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const mm = mindMapRef.current
    if (!mm) return
    const node = requireActiveNode(mm)
    if (!node) return
    try {
      const up = await uploadFile(file)
      node.setImage?.({ url: up.url, title: up.filename, width: 120, height: 120 })
      message.success('图片已插入节点')
    } catch (err) {
      message.error((err as Error)?.message || '图片插入失败')
    }
  }

  function runNodeCommand(command: string, tip: string) {
    const mm = requireMindMap()
    if (!mm) return
    if (!requireActiveNode(mm)) return
    mm.execCommand(command)
    if (tip) message.info(tip)
  }

  function centerRoot() {
    const mm = requireMindMap()
    if (!mm) return
    mm.renderer.setRootNodeCenter()
    mm.view.reset()
  }

  function zoomIn() {
    requireMindMap()?.view.enlarge()
  }

  function zoomOut() {
    requireMindMap()?.view.narrow()
  }

  function resetZoom() {
    requireMindMap()?.view.reset()
  }

  function fitCanvas() {
    requireMindMap()?.view.fit()
  }

  function applyFont(family: string) {
    const mm = requireMindMap()
    if (!mm) return
    setFontFamily(family)
    const base = baseThemeRef.current
    mm.setTheme({
      ...base,
      root: { ...(base.root as Record<string, unknown>), fontFamily: family },
      second: { ...(base.second as Record<string, unknown>), fontFamily: family },
      node: { ...(base.node as Record<string, unknown>), fontFamily: family },
    } as never)
  }

  async function exportPng() {
    const mm = requireMindMap()
    if (!mm) return
    try {
      await mm.export('png', true, titleRef.current || '思维导图')
    } catch {
      message.error('导出失败，请重试')
    }
  }

  /** 从当前导图数据生成缩进大纲文本 */
  const getOutline = useCallback(() => {
    const root = latestRef.current as unknown as OutlineNode | null
    if (!root) return ''
    const lines: string[] = []
    const walk = (n: OutlineNode, depth: number) => {
      const text = n.data?.text ?? ''
      lines.push(`${'    '.repeat(depth)}${depth > 0 ? '- ' : '# '}${text || '（无标题）'}`)
      for (const c of n.children ?? []) walk(c, depth + 1)
    }
    walk(root, 0)
    return lines.join('\n')
  }, [])

  return (
    <div
      style={
        fullscreen
          ? { position: 'fixed', inset: 0, zIndex: 1000, background: '#fff', display: 'flex', flexDirection: 'column' }
          : { height: '100%', display: 'flex', flexDirection: 'column' }
      }
    >
      {/* 画布与浮动工具条同层容器（工具条绝对定位在画布之上，不占布局高度） */}
      {/* 画布与浮动工具条同层容器：工具条与面板抽屉都绝对定位，不参与布局，
          因此画布宿主的尺寸只由本容器决定，面板开合不会改变它（避免 resize→render 抖动回路） */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#fbfbfc', overflow: 'hidden' }}>
        {/* simple-mind-map 自管理内部尺寸（拖拽画布平移 / 滚轮缩放）。
            overflow:hidden —— 画布内容外溢时不产生滚动条，也就不可能反过来撑大本容器
            （容器尺寸一旦被内容影响，就会和 ResizeObserver 形成抖动回路） */}
        <div ref={elRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />

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
          onBack={goBack}
          onForward={goForward}
          onToggleBrush={toggleBrush}
          onAddSibling={addSibling}
          onAddChild={addChild}
          onRemoveNode={removeActiveNode}
          onPickImage={pickImage}
          onHyperlink={() => runNodeCommand('SET_NODE_HYPERLINK', '')}
          onNote={() => runNodeCommand('SET_NODE_NOTE', '')}
          onTag={() => runNodeCommand('SET_NODE_TAG', '')}
          onGeneralization={() => runNodeCommand('ADD_GENERALIZATION', '请在选中节点上输入概要文本')}
          onAssociativeLine={() => runNodeCommand('ADD_ASSOCIATIVE_LINE', '再点击另一个节点即可生成关联线')}
          onFormula={() => runNodeCommand('INSERT_FORMULA', '')}
          onOuterFrame={() => runNodeCommand('ADD_OUTER_FRAME', '已为选中节点添加外框')}
          onSave={() => void doSave('manual')}
          onOpenVersions={() => setVersionOpen(true)}
          onExportPng={() => void exportPng()}
        />

        {/* onPanelToggle：面板开合期间通知画布跳过 resize（抽屉动画会连续 reflow） */}
        <MindmapSideToolbar handle={handle} getOutline={getOutline} onPanelToggle={onPanelToggle} />

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
