/**
 * 秒传（内容去重）上传链路：算摘要 → 预检 → 秒传落 meta / 普通上传。
 *
 * 铁律：**任何一步失败都必须退化为普通上传，绝不中断用户操作**。
 * 触发降级的场景（全部覆盖）：
 *  - `computeFileMD5` 抛错（Worker + 主线程都失败）→ 不带摘要走普通上传；
 *  - 预检请求失败 / 非 0 code（老后端没有该接口、网络抖动）→ 普通上传；
 *  - 秒传落 meta 失败（`40401` 未知 md5、`40901` size 不符、其它）→ 普通上传。
 *
 * 批量形态（图片库 / 原型）走两阶段协议：①批量预检（无字节）→ ②一次
 * 「manifest + 仅未命中文件字节」的混合 multipart 提交。manifest 是唯一真源，
 * 其长度与顺序必须与调用方提交的条目严格一致（见 T03b 的服务端校验）。
 */
import { instantUpload, precheckUpload, precheckUploadBatch, uploadFile } from '../api/uploads'
import { computeFileMD5 } from './md5'
import type { BatchManifestEntry, UploadResult } from '../types'

/** 预检批量的单次上限，与后端 `precheckMaxItems` 对齐 */
const PRECHECK_BATCH_MAX = 100

export interface UploadWithDedupOptions {
  /** 已算好的摘要（批量场景复用，避免重复读盘） */
  md5?: string
  /** 该文件摘要计算进度，0..1 */
  onHashProgress?: (p: number) => void
}

export interface UploadWithDedupResult extends UploadResult {
  /** 本次是否命中秒传（true = 未传输文件字节，服务端仅新增引用） */
  dedup: boolean
}

/**
 * 单文件上传（带秒传）：命中即用 `/uploads/instant` 落 meta，未命中走普通 multipart。
 * 返回值的 `url` 两种路径都可用，调用方无需区分。
 */
export async function uploadWithDedup(file: File, opts?: UploadWithDedupOptions): Promise<UploadWithDedupResult> {
  const md5 = await safeMD5(file, opts)
  if (md5) {
    const instant = await tryInstant(file, md5)
    if (instant) return instant
  }
  const out = await uploadFile(file, md5 ? { md5 } : undefined)
  return { ...out, dedup: Boolean(out.dedup) }
}

/** 算摘要；失败返回空串（降级用，绝不因算摘要失败而中断上传）。 */
async function safeMD5(file: File, opts?: UploadWithDedupOptions): Promise<string> {
  if (opts?.md5) return opts.md5
  try {
    return await computeFileMD5(file, opts?.onHashProgress)
  } catch {
    return ''
  }
}

/** 尝试秒传；未命中或任何异常返回 null（调用方退化为普通上传）。 */
async function tryInstant(file: File, md5: string): Promise<UploadWithDedupResult | null> {
  try {
    const pre = await precheckUpload(md5, file.size, file.name)
    if (!pre?.hit) return null
    const out = await instantUpload({
      md5,
      size: file.size,
      filename: file.name,
      mime: file.type || undefined,
    })
    return { ...out, dedup: true }
  } catch {
    return null
  }
}

export interface BatchUploadOptions {
  /** 上传目标应用（gallery | prototype）。协议本身不区分，仅供调用方透传与日志。 */
  app?: string
  /** 业务附加元数据（同上，透传用） */
  meta?: Record<string, unknown>
  /** 阶段回调：phase=hash 时 index 为**当前正在算的**下标（0 基） */
  onPhase?: (phase: 'hash' | 'precheck', index: number, total: number) => void
}

/** 两阶段协议的批次计划（供 T03b 的入库接口直接使用）。 */
export interface BatchUploadPlan {
  /** 与入参 `files` **等长且同序**的 manifest */
  manifest: BatchManifestEntry[]
  /** 仅 `kind=file` 的字节，顺序 = manifest 中 `kind=file` 的出现顺序 */
  missFiles: File[]
  /** 与 manifest 同序：命中条目的 md5；未命中为空串 */
  hashes: string[]
  /** `kind=ref` 在 manifest 中的下标（升序） */
  refIndexes: number[]
}

/**
 * 批量上传规划：顺序算摘要 → 批量预检 → 组装 manifest。
 *
 * **顺序**计算摘要（单 Worker 串行）：同时读多个大文件会把磁盘 IO 打爆（R14），
 * 顺序读在机械盘/网络盘上反而更快；同时通过 `onPhase` 上报「计算校验值 i/n」。
 *
 * 只做**规划**，不传输字节 —— 调用方拿 `missFiles` 与 `manifest` 走一次混合提交。
 */
export async function uploadBatchWithDedup(
  files: File[],
  opts?: BatchUploadOptions,
): Promise<BatchUploadPlan> {
  const total = files.length
  const hashes: string[] = []
  for (let i = 0; i < total; i++) {
    opts?.onPhase?.('hash', i, total)
    hashes.push(await safeMD5(files[i]))
  }

  const hits = await precheckAll(files, hashes, opts)

  const manifest: BatchManifestEntry[] = []
  const missFiles: File[] = []
  const refIndexes: number[] = []
  for (let i = 0; i < total; i++) {
    if (hits[i] && hashes[i]) {
      manifest.push({ kind: 'ref', md5: hashes[i], name: files[i].name, size: files[i].size })
      refIndexes.push(i)
    } else {
      manifest.push({ kind: 'file', name: files[i].name, size: files[i].size })
      missFiles.push(files[i])
    }
  }
  return { manifest, missFiles, hashes, refIndexes }
}

/** 批量预检（按 100 上限分批）；整批失败/异常 → 全部视为未命中（退化为普通上传）。 */
async function precheckAll(files: File[], hashes: string[], opts?: BatchUploadOptions): Promise<boolean[]> {
  const total = files.length
  const hits: boolean[] = new Array(total).fill(false)
  opts?.onPhase?.('precheck', total, total)
  try {
    for (let start = 0; start < total; start += PRECHECK_BATCH_MAX) {
      const end = Math.min(total, start + PRECHECK_BATCH_MAX)
      // 摘要为空的条目（算摘要失败）直接跳过预检：它们必然要上传
      const askable: number[] = []
      for (let i = start; i < end; i++) {
        if (hashes[i]) askable.push(i)
      }
      if (askable.length === 0) continue
      const res = await precheckUploadBatch(
        askable.map((i) => ({ md5: hashes[i], size: files[i].size, filename: files[i].name })),
      )
      for (const r of res?.results ?? []) {
        const globalIdx = askable[r?.index]
        if (globalIdx === undefined) continue
        hits[globalIdx] = Boolean(r.hit)
      }
    }
  } catch {
    // 预检异常：静默全部退化为普通上传
  }
  return hits
}
