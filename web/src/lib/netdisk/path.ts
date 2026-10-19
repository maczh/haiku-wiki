/**
 * 网盘路径工具。**与后端 `server/internal/netdisk/path.go` 同一口径**（设计文档 §8.2）。
 *
 * 约定：
 *   - 一律 `/` 分隔的绝对路径，根目录为 `"/"`；
 *   - 目录路径**不带尾斜杠**（除根）；
 *   - 禁止 `..`（穿越目录）。
 */

/** 规范化路径：去尾斜杠、折叠重复斜杠、拒绝 `..` */
export function cleanPath(p: string): string {
  if (!p) return '/'
  let s = p.replace(/\\/g, '/').trim()
  if (!s.startsWith('/')) s = `/${s}`
  // 折叠重复斜杠
  s = s.replace(/\/{2,}/g, '/')
  // 去尾斜杠（根保留单个 /）
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '')
  if (s === '') s = '/'
  if (s.split('/').includes('..')) throw new Error('路径不允许包含 ".."')
  return s
}

/** 在父目录下拼接子名（子名不允许带斜杠） */
export function joinPath(parent: string, name: string): string {
  const base = cleanPath(parent)
  const child = name.trim().replace(/[/\\]+/g, '')
  if (!child) throw new Error('名称不能为空')
  return base === '/' ? `/${child}` : `${base}/${child}`
}

/** 取最后一段（根目录返回空串） */
export function baseName(p: string): string {
  const s = cleanPath(p)
  if (s === '/') return ''
  return s.slice(s.lastIndexOf('/') + 1)
}

/** 取父目录（根目录的父仍是根） */
export function parentPath(p: string): string {
  const s = cleanPath(p)
  if (s === '/') return '/'
  const i = s.lastIndexOf('/')
  if (i <= 0) return '/'
  return s.slice(0, i)
}

/** 面包屑分段：['2026', '设计稿']（根不计入，由 UI 单独渲染） */
export function pathSegments(p: string): { name: string; path: string }[] {
  const s = cleanPath(p)
  if (s === '/') return []
  const parts = s.split('/').filter(Boolean)
  const out: { name: string; path: string }[] = []
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    out.push({ name: part, path: acc })
  }
  return out
}

/** ancestor 是否是 path 的祖先（或相等） */
export function isSameOrAncestor(ancestor: string, path: string): boolean {
  const a = cleanPath(ancestor)
  const b = cleanPath(path)
  return a === b || b.startsWith(a === '/' ? '/' : `${a}/`)
}

/** path 是否在 ancestor 内部（不含自身）—— 用于「禁止移动到自身子目录」 */
export function isDescendantOf(ancestor: string, path: string): boolean {
  const a = cleanPath(ancestor)
  const b = cleanPath(path)
  if (a === b) return false
  return b.startsWith(a === '/' ? '/' : `${a}/`)
}

/** 移动合法性：不能移到自身或自身的子目录 */
export function isValidMoveTarget(srcPath: string, targetDir: string): boolean {
  return !isSameOrAncestor(srcPath, targetDir)
}
