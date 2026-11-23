import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { writeAtomic } from '../store/fsRepo.js'

interface CacheEntry {
  key: string
  raw: string
  model: string
  createdAt: string
  lastUsed: string
  hits: number
}

const MAX_ENTRIES = 300

let entries: Map<string, CacheEntry> | null = null
let loadedFile = ''

function fileOf(): string {
  return path.join(config.dataDir, 'llm-cache.json')
}

function load(): Map<string, CacheEntry> {
  const file = fileOf()
  if (entries && loadedFile === file) return entries
  entries = new Map()
  loadedFile = file
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry[]
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry && typeof entry.key === 'string' && typeof entry.raw === 'string') entries.set(entry.key, entry)
        }
      }
    } catch {
      console.warn('[llm-cache] 缓存文件解析失败，按空缓存处理')
    }
  }
  return entries
}

function persist(): void {
  const map = load()
  fs.mkdirSync(config.dataDir, { recursive: true })
  writeAtomic(fileOf(), JSON.stringify([...map.values()], null, 2))
}

/** 缓存键只由"会改变模型输出的输入"构成；prompt 文本本身在 messages 里，改 prompt 自然失效 */
export function cacheKey(parts: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export function readCache(key: string): string | null {
  const map = load()
  const entry = map.get(key)
  if (!entry) return null
  entry.hits++
  entry.lastUsed = new Date().toISOString()
  return entry.raw
}

export function writeCache(key: string, raw: string, model: string): void {
  const map = load()
  const now = new Date().toISOString()
  map.set(key, { key, raw, model, createdAt: now, lastUsed: now, hits: 0 })
  if (map.size > MAX_ENTRIES) {
    const oldest = [...map.values()].sort((a, b) => a.lastUsed.localeCompare(b.lastUsed))
    for (const entry of oldest.slice(0, map.size - MAX_ENTRIES)) map.delete(entry.key)
  }
  persist()
}

/** 仅测试/重置用 */
export function clearCache(): void {
  entries = new Map()
  loadedFile = ''
  const file = fileOf()
  if (fs.existsSync(file)) fs.unlinkSync(file)
}