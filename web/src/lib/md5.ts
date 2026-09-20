/**
 * 文件内容摘要（MD5）计算：Worker 优先，主线程分片兜底。
 *
 * 设计要点：
 *  1. **Worker 不可用也能用**：沙箱 / 严格 CSP / 老浏览器下 `new Worker` 会抛异常，
 *     或 Worker 运行时出错。此时**不报错**，直接在主线程按同样的分片方式算完
 *     —— 秒传是优化而非功能，绝不能因为 Worker 不可用就把上传整体搞挂。
 *  2. **单 Worker 串行**：所有调用共享一个 Worker，并由内部 Promise 链排队。
 *     批量导入时若并发读多个大文件，磁盘 IO 会被打爆（R14），顺序读反而更快更稳。
 *  3. 分片 4 MiB：太小则 read/postMessage 往返开销上升，太大则在机械盘/网络盘上
 *     单次阻塞过久。
 */
import SparkMD5 from 'spark-md5'
import type { Md5Request, Md5Response } from './md5.worker'

/** 分片大小：4 MiB */
const CHUNK_SIZE = 4 * 1024 * 1024

/** 共享 Worker（懒创建）；一旦创建失败或运行出错就置空并标记不可用，后续走主线程 */
let sharedWorker: Worker | null = null
let workerUnavailable = false

/** 串行链：保证同一时刻只有一个文件在算，避免并发读盘 */
let chain: Promise<unknown> = Promise.resolve()

/**
 * 计算文件内容摘要。
 *
 * @param file 目标文件（只读取，不改动）
 * @param onProgress 可选的进度回调，入参为该文件的完成比例 0..1
 * @returns 32 位小写 hex；与后端 `md5Hex(data)` 口径一致
 */
export function computeFileMD5(file: File, onProgress?: (p: number) => void): Promise<string> {
  const run = () => computeOnce(file, onProgress)
  // 上一次无论成功失败都不影响本次：链上挂的是「永远 resolve」的尾巴
  const task = chain.then(run, run)
  chain = task.catch(() => undefined)
  return task
}

async function computeOnce(file: File, onProgress?: (p: number) => void): Promise<string> {
  const worker = getWorker()
  if (worker) {
    try {
      return await viaWorker(worker, file, onProgress)
    } catch {
      // Worker 路径失败（CSP / 沙箱 / 中途异常）：回收并永久降级到主线程
      workerUnavailable = true
      try {
        worker.terminate()
      } catch {
        /* terminate 失败无所谓，标记已经置上 */
      }
      sharedWorker = null
    }
  }
  return viaMainThread(file, onProgress)
}

function getWorker(): Worker | null {
  if (workerUnavailable) return null
  if (sharedWorker) return sharedWorker
  try {
    // Vite 语法：`new Worker(new URL(...), { type: 'module' })` 会被静态分析并单独打包
    sharedWorker = new Worker(new URL('./md5.worker.ts', import.meta.url), { type: 'module' })
    return sharedWorker
  } catch {
    workerUnavailable = true
    return null
  }
}

function viaWorker(worker: Worker, file: File, onProgress?: (p: number) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const onMessage = (e: MessageEvent<Md5Response>) => {
      const data = e.data
      if (!data) return
      if (typeof data.progress === 'number') onProgress?.(data.progress)
      if (data.md5) {
        cleanup()
        resolve(data.md5)
      } else if (data.error) {
        cleanup()
        reject(new Error(data.error))
      }
    }
    const onError = (ev: ErrorEvent) => {
      cleanup()
      reject(ev.error instanceof Error ? ev.error : new Error('md5 worker 运行失败'))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const req: Md5Request = { blob: file, chunkSize: CHUNK_SIZE }
    worker.postMessage(req)
  })
}

/** 主线程兜底：与 Worker 完全相同的分片方式与结果口径。 */
async function viaMainThread(file: File, onProgress?: (p: number) => void): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer()
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  for (let i = 0; i < total; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(file.size, start + CHUNK_SIZE)
    const buf = await file.slice(start, end).arrayBuffer()
    spark.append(buf)
    onProgress?.((i + 1) / total)
  }
  return spark.end()
}
