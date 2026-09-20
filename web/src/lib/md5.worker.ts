/**
 * MD5 分片计算 Worker：把「读文件 + 算摘要」挪出主线程。
 *
 * 为什么必须用 Worker：一张 50MB 的图纸在主线程上做 4MiB 分片读取 + MD5，
 * 会连续占用主线程数百毫秒，期间页面无法响应点击/滚动。批量导入（图片库往往
 * 一次几十张）更明显。
 *
 * ⚠️ 不引用 `lib.webworker` 的 DOM 类型：本项目 tsconfig 的 `lib` 里已有 `DOM`，
 * 同时引入 webworker 库会与之产生同名全局冲突。这里用一个最小的局部接口描述
 * Worker 全局对象，够用且零冲突。
 */
import SparkMD5 from 'spark-md5'

/** 主线程 → Worker 的请求 */
export interface Md5Request {
  blob: Blob
  chunkSize: number
}

/** Worker → 主线程的响应（进度与最终结果分开上报） */
export interface Md5Response {
  /** 该文件的进度，0..1 */
  progress?: number
  /** 计算完成时的 32 位小写 hex */
  md5?: string
  /** 失败原因（Worker 内部异常） */
  error?: string
}

/** Worker 全局对象的最小接口（避开 webworker lib 的冲突）。 */
interface WorkerScope {
  postMessage: (message: Md5Response) => void
  onmessage: ((e: MessageEvent<Md5Request>) => void) | null
}

const scope = self as unknown as WorkerScope

scope.onmessage = async (e: MessageEvent<Md5Request>) => {
  const { blob, chunkSize } = e.data ?? ({} as Md5Request)
  try {
    const spark = new SparkMD5.ArrayBuffer()
    // 空文件也要走一轮（total 至少为 1），否则 hash 会停在初始态而不是空内容的摘要
    const total = Math.max(1, Math.ceil(blob.size / chunkSize))
    for (let i = 0; i < total; i++) {
      const start = i * chunkSize
      const end = Math.min(blob.size, start + chunkSize)
      const buf = await blob.slice(start, end).arrayBuffer()
      spark.append(buf)
      scope.postMessage({ progress: (i + 1) / total })
    }
    scope.postMessage({ md5: spark.end(), progress: 1 })
  } catch (err) {
    scope.postMessage({ error: (err as Error)?.message || 'md5 worker 计算失败' })
  }
}
