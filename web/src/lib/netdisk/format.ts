/**
 * 网盘相关的展示格式化（文件大小 / 时间 / 类型标签）。
 * 与文库其它模块的展示口径保持一致，避免同一种信息在两处长得不一样。
 */

/** 文件大小：1024 进制，保留一位小数（整数值不带 .0） */
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  // ≥100 或字节级取整；其余保留一位小数并去掉「.0」尾巴
  const n = v >= 100 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10
  return `${n} ${units[i]}`
}

/** 修改时间：YYYY-MM-DD HH:mm */
export function formatTime(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 进度百分比 0-100 */
export function formatPercent(p: number): string {
  return `${Math.max(0, Math.min(100, Math.round(p || 0)))}%`
}

/** 任务类型中文标签 */
export function taskTypeLabel(type: string): string {
  return type === 'import' ? '导入到文库' : type === 'upload' ? '上传到网盘' : type
}

/** 任务状态中文标签 */
export function taskStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '排队中',
    running: '进行中',
    success: '已完成',
    failed: '失败',
    canceled: '已取消',
  }
  return map[status] || status
}

/** 任务状态对应 antd Tag 色 */
export function taskStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending: 'default',
    running: 'processing',
    success: 'success',
    failed: 'error',
    canceled: 'warning',
  }
  return map[status] || 'default'
}

// ---------- 导入白名单 ----------

import { IMPORT_EXTENSIONS, extOfName } from '../import/formats'

/**
 * 「导入到文库」白名单。
 *
 * 唯一事实来源是 `lib/import/formats.ts` 的 `IMPORT_EXTENSIONS`（**不另写一份**），
 * 这里只做一件事：把解析器明确拒绝的 `wps` / `dps` 剔掉（它们会由 parse.ts 给出
 * 友好拒绝文案，但网盘侧的按钮应该直接置灰，不该让用户点了才失败）。
 */
const IMPORTABLE = new Set(IMPORT_EXTENSIONS.filter((e) => e !== 'wps' && e !== 'dps'))

/** 该文件名能否导入到文库 */
export function isNetdiskImportable(name: string): boolean {
  const ext = extOfName(name)
  return ext !== '' && IMPORTABLE.has(ext)
}

/** 不可导入时的 Tooltip 文案 */
export function netdiskImportReason(name: string): string {
  const ext = extOfName(name)
  return ext ? `暂不支持导入（.${ext}）` : '暂不支持导入（无法识别文件类型）'
}
