import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Button } from 'antd'

interface Props {
  children: ReactNode
  /**
   * 自定义兜底渲染：拿到异常与 reset（重挂子树）回调。
   * 不传则退化为一个通用的「渲染失败」告警 + 刷新按钮。
   */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * 通用错误边界：捕获子树渲染期异常（pdf.js 加载失败、思维导图 JSON 异常、
 * Office 组件崩溃等），把「白屏 / 无限菊花」变成可点击重试 / 刷新的明确提示。
 *
 * 与 LazyBoundary 内的私有 ErrorBoundary 不同，这里支持自定义 fallback 与
 * reset（重挂子树而不是整页刷新），更适合「预览失败 → 重试」这类交互。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 仅在控制台留痕，避免污染界面；界面提示交给 fallback。
    console.error('[ErrorBoundary] 子树渲染失败', error, info.componentStack)
  }

  /** 清空错误并重新挂载 children（key 不变也能触发重渲染） */
  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <Alert
        type="error"
        showIcon
        message="渲染失败"
        description={error.message || '内容加载或解析出错'}
        action={
          <Button size="small" onClick={() => window.location.reload()}>
            刷新
          </Button>
        }
        style={{ margin: 24 }}
      />
    )
  }
}
