import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

export type Collection = 'projects' | 'requirements' | 'cases' | 'compares' | 'reviews' | 'gapReviews' | 'traces'

const cache = new Map<Collection, unknown[]>()

function fileOf(col: Collection): string {
  return path.join(config.dataDir, `${col}.json`)
}

/**
 * 原子写：先写临时文件再 rename，避免中途崩溃把数据写坏。
 *
 * Windows 上 rename 覆盖已存在文件时，如果目标文件正被杀毒/索引服务或残留句柄短暂占用，
 * 会抛 EPERM。这种情况不能直接失败（生成过程中四类场景并行保存，一失败整批就断），
 * 退化为直接覆盖写——本地单用户场景下数据量很小，最坏只会丢一次写入，下次保存会补上。
 */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* 临时文件可能已不存在 */
    }
    fs.writeFileSync(file, content, 'utf8')
  }
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
export function resetAll(): void {
  for (const col of ['projects', 'requirements', 'cases', 'compares', 'reviews', 'gapReviews', 'traces'] as Collection[]) {
    cache.set(col, [])
    save(col)
  }
}
