/**
 * 网盘目录缓存（前端）。
 *
 * 口径与设计文档 §3.4-B 一致：
 *   - key = `${connId}::${path}`；
 *   - TTL 5 分钟；
 *   - 写操作后**失效该目录及其祖先链上受影响节点的缓存**（因为祖先目录的
 *     size / mod_time / 是否为空会变），并重新拉取。
 *
 * 为什么不做「整连接失效」：目录树是懒加载的，逐级点开时只想重取受影响的一两级，
 * 全清会让用户每改一次就整棵树重新转圈。
 */

const TTL_MS = 5 * 60 * 1000

interface CacheItem {
  items: import('../../types').NetdiskEntry[]
  ts: number
}

const cache = new Map<string, CacheItem>()

/** 命中且未过期才返回；过期条目顺带删掉 */
export function dirCacheGet(connId: number, path: string): import('../../types').NetdiskEntry[] | null {
  const key = cacheKey(connId, path)
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.items
}

export function dirCacheSet(connId: number, path: string, items: import('../../types').NetdiskEntry[]): void {
  cache.set(cacheKey(connId, path), { items, ts: Date.now() })
}

/** 失效该目录及其全部祖先（根目录 '/' 也在链上） */
export function dirCacheInvalidate(connId: number, path: string): void {
  let p = path
  while (true) {
    cache.delete(cacheKey(connId, p))
    if (p === '/' || p === '') break
    const i = p.lastIndexOf('/')
    p = i <= 0 ? '/' : p.slice(0, i)
  }
  cache.delete(cacheKey(connId, '/'))
}

/** 连接被删除 / 重新授权时整连接失效 */
export function dirCacheInvalidateConn(connId: number): void {
  const prefix = `${connId}::`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/** 全清（登出 / 测试用） */
export function dirCacheClear(): void {
  cache.clear()
}

function cacheKey(connId: number, path: string): string {
  return `${connId}::${path}`
}
