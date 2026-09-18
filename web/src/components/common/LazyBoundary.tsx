import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Button, Spin } from 'antd'

interface Props {
  children: ReactNode
  /** 占位提示文案（按文档类型区分，便于用户理解在加载什么） */
  tip?: string
  /**
   * 撑满父容器并垂直居中。
   * 用于路由级懒加载 —— 父级（AppLayout 的 `main{flex:1}`、`#root`）高度确定，
   * 占位会居中在内容区而不是顶在左上角。
   */
  fill?: boolean
}

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends Component<{ children: ReactNode; tip?: string }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('懒加载组件渲染失败', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Alert
        type="error"
        showIcon
        message="编辑器加载失败"
        description={this.state.error.message || this.props.tip || '请刷新页面后重试'}
        action={<Button size="small" onClick={() => window.location.reload()}>刷新</Button>}
        style={{ margin: 24 }}
      />
    )
  }
}

/**
 * 懒加载边界：为 React.lazy 包裹的编辑器 / 渲染器 / 页面提供统一的加载占位。
 *
 * 背景：Vditor、simple-mind-map、Luckysheet、pdf.js、mermaid 合计体积很大，
 * 若全部静态 import，会挤进首屏 chunk（实测单包 3.8 MB）。
 * 这些组件都只在打开对应类型的文档时才需要，因此统一改为按需加载。
 *
 * 注意：Suspense 自身不渲染额外 DOM 节点（未挂起时直接渲染子节点），
 * 只有 fallback 会占位，因此不会破坏 `.toc-scroll-root` 的 `height: 100%` 高度链。
 */
export default function LazyBoundary({ children, tip, fill }: Props) {
  return (
    <ErrorBoundary tip={tip}>
      <Suspense
        fallback={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 48,
              ...(fill ? { height: '100%', padding: 0 } : null),
              color: '#8a919f',
              fontSize: 13,
            }}
          >
            <Spin size="small" />
            <span>{tip ?? '正在加载…'}</span>
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}
