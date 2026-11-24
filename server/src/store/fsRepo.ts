import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

export type Collection = 'projects' | 'requirements' | 'cases' | 'compares' | 'reviews' | 'gapReviews' | 'traces' | 'designTasks'

const cache = new Map<Collection, unknown[]>()

function fileOf(col: Collection): string {
  return path.join(config.dataDir, `${col}.json`)
}

/**
 * 原子写：先写临时文件再 rename，避免中途崩溃把数据写坏。
 *
 * 临时文件写入或重命名失败时保留旧文件并向调用方报错，不退化为可能截断目标文件的直接覆盖。
 * Windows 下 rename 覆盖已存在文件时可能偶发遇到 EPERM / EBUSY（杀毒软件扫描、索引或并发读取占用句柄），
 * 采用短暂重试退避机制，提高文件并发写入稳定性。
 */
export function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')

  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (error: any) {
      lastError = error
      if ((error?.code === 'EPERM' || error?.code === 'EBUSY') && attempt < 4) {
        // 短暂自旋等待句柄释放（25ms ~ 100ms）
        const waitMs = (attempt + 1) * 25
        const start = Date.now()
        while (Date.now() - start < waitMs) {
          /* wait */
        }
      } else {
        break
      }
    }
  }

  try {
    fs.unlinkSync(tmp)
  } catch {
    /* 临时文件可能已不存在 */
  }
  throw lastError
}

/**
 * 读取整个集合（返回缓存引用，就地修改后调用 save 落盘）
 * 集合不存在时返回空数组并落一个空文件
 */
export function all<T>(col: Collection): T[] {
  const cached = cache.get(col)
  if (cached) return cached as T[]

  fs.mkdirSync(config.dataDir, { recursive: true })
  const file = fileOf(col)
  let items: T[] = []
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(parsed)) items = parsed as T[]
    } catch {
      console.warn(`[store] ${col}.json 解析失败，已按空集合处理`)
    }
  }
  cache.set(col, items as unknown[])
  return items
}

export function save(col: Collection): void {
  const items = cache.get(col) ?? []
  fs.mkdirSync(config.dataDir, { recursive: true })
  writeAtomic(fileOf(col), JSON.stringify(items, null, 2))
}

export function findById<T extends { id: string }>(col: Collection, id: string): T | undefined {
  return all<T>(col).find((item) => item.id === id)
}

export function insert<T extends { id: string }>(col: Collection, item: T): T {
  all<T>(col).push(item)
  save(col)
  return item
}

export function update<T extends { id: string }>(col: Collection, id: string, patch: Partial<T>): T | undefined {
  const list = all<T>(col)
  const idx = list.findIndex((item) => item.id === id)
  if (idx === -1) return undefined
  list[idx] = { ...list[idx], ...patch }
  save(col)
  return list[idx]
}

export function remove<T extends { id: string }>(col: Collection, id: string): boolean {
  const list = all<T>(col)
  const idx = list.findIndex((item) => item.id === id)
  if (idx === -1) return false
  list.splice(idx, 1)
  save(col)
  return true
}

export function removeWhere<T extends { id: string }>(col: Collection, pred: (item: T) => boolean): number {
  const list = all<T>(col)
  let removed = 0
  for (let i = list.length - 1; i >= 0; i--) {
    if (pred(list[i])) {
      list.splice(i, 1)
      removed++
    }
  }
  if (removed) save(col)
  return removed
}

/** 清空全部集合（仅测试/重置用） */
export function resetAll(expectedDataDir: string): void {
  if (typeof expectedDataDir !== 'string' || path.resolve(config.dataDir) !== path.resolve(expectedDataDir)) {
    throw new Error('拒绝重置：当前数据目录与指定的测试目录不一致')
  }
  for (const col of ['projects', 'requirements', 'cases', 'compares', 'reviews', 'gapReviews', 'traces', 'designTasks'] as Collection[]) {
    cache.set(col, [])
    save(col)
  }
}
