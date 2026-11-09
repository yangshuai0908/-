import type { ChangeItem, Chunk, RequirementVersion, TestCase } from '../store/schema.js'
import { numeralsOf, normalize } from '../validate/evidence.js'

/** 取标题路径的最后一段（"3 登录 / 3.1 账号密码登录" → "3.1 账号密码登录"） */
export function tailPath(path: string): string {
  const parts = path.split(' / ')
  return parts[parts.length - 1] ?? path
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

/** 归一化后的 bigram Dice 相似度，用于判断两段文本是否讲同一件事 */
export function textSimilarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  const A = bigrams(na)
  const B = bigrams(nb)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return (2 * inter) / (A.size + B.size)
}

/** 相同的判定阈值：高于这个值且数值未变，认为条款没实质变化 */
const UNCHANGED_THRESHOLD = 0.96
/** 低于这个值就不认为是同一个条款（判为删+增而不是改） */
const MATCH_THRESHOLD = 0.6

/**
 * 数值是否发生变化。
 * 这条是必须的独立判断：改一个数字（6-20 → 8-20）文本相似度仍有 0.98，
 * 光看相似度会把最关键的阈值修改漏掉。
 */
function numeralsDiffer(a: string, b: string): boolean {
  const A = numeralsOf(normalize(a))
  const B = numeralsOf(normalize(b))
  if (A.size !== B.size) return true
  for (const n of A) if (!B.has(n)) return true
  return false
}

export interface DiffResult {
  changes: ChangeItem[]
  /** v1 reqId → v2 reqId */
  mapping: Map<string, string>
  stats: { added: number; removed: number; modified: number; unchanged: number }
}

/**
 * 条款级差异对比（确定性算法，不经过模型）
 * 1. 标题尾段相同的先配对
 * 2. 剩下的按文本相似度贪心配对（≥0.6 视为同一条款被改写）
 * 3. 剩余：v1 独有 → removed，v2 独有 → added
 */
export function diffChunks(from: Chunk[], to: Chunk[]): DiffResult {
  const usedTo = new Set<string>()
  const mapping = new Map<string, string>()
  const changes: ChangeItem[] = []

  for (const f of from) {
    const match = to.find((t) => !usedTo.has(t.reqId) && tailPath(t.sectionPath) === tailPath(f.sectionPath))
    if (!match) continue
    usedTo.add(match.reqId)
    mapping.set(f.reqId, match.reqId)
    const score = textSimilarity(f.text, match.text)
    const materiallyChanged = score < UNCHANGED_THRESHOLD || numeralsDiffer(f.text, match.text)
    changes.push({
      type: materiallyChanged ? 'modified' : 'unchanged',
      sectionPath: tailPath(f.sectionPath),
      fromReqId: f.reqId,
      toReqId: match.reqId,
      before: f.text,
      after: match.text,
      score,
    })
  }

  const restFrom = from.filter((f) => !mapping.has(f.reqId))
  const restTo = to.filter((t) => !usedTo.has(t.reqId))

  for (const f of restFrom) {
    let best: { chunk: Chunk; score: number } | null = null
    for (const t of restTo) {
      if (usedTo.has(t.reqId)) continue
      const score = textSimilarity(f.text, t.text)
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { chunk: t, score }
    }
    if (best) {
      usedTo.add(best.chunk.reqId)
      mapping.set(f.reqId, best.chunk.reqId)
      changes.push({
        type: 'modified',
        sectionPath: tailPath(best.chunk.sectionPath),
        fromReqId: f.reqId,
        toReqId: best.chunk.reqId,
        before: f.text,
        after: best.chunk.text,
        score: best.score,
      })
    } else {
      changes.push({
        type: 'removed',
        sectionPath: tailPath(f.sectionPath),
        fromReqId: f.reqId,
        before: f.text,
        score: 0,
      })
    }
  }

  for (const t of to) {
    if (usedTo.has(t.reqId)) continue
    changes.push({
      type: 'added',
      sectionPath: tailPath(t.sectionPath),
      toReqId: t.reqId,
      after: t.text,
      score: 0,
    })
  }

  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 }
  for (const c of changes) stats[c.type]++

  return { changes, mapping, stats }
}

/**
 * 找出受影响的用例（确定性）
 * - 引用了被删除条款 → 需要人工确认是否废弃
 * - 引用了被修改条款 → 需要调整
 * - 引用未变条款 → 不受影响，直接放过
 */
export function findImpactedCases(
  cases: TestCase[],
  diff: DiffResult,
): { impacted: TestCase[]; untouched: TestCase[]; removedRefs: Map<string, ChangeItem> } {
  const byFromId = new Map<string, ChangeItem>()
  const byToId = new Map<string, ChangeItem>()
  for (const c of diff.changes) {
    if (c.fromReqId) byFromId.set(c.fromReqId, c)
    if (c.toReqId) byToId.set(c.toReqId, c)
  }

  const impacted: TestCase[] = []
  const untouched: TestCase[] = []
  const removedRefs = new Map<string, ChangeItem>()

  for (const c of cases) {
    let hit = false
    for (const ev of c.evidence) {
      const change = byFromId.get(ev.reqId) ?? byToId.get(ev.reqId)
      if (!change || change.type === 'unchanged') continue
      hit = true
      if (change.type === 'removed') removedRefs.set(c.id, change)
    }
    if (hit) impacted.push(c)
    else untouched.push(c)
  }

  return { impacted, untouched, removedRefs }
}

/** 对比前的基本校验 */
export function assertComparable(from: RequirementVersion, to: RequirementVersion): void {
  if (from.id === to.id) throw new Error('请选择两个不同的需求版本')
  if (from.projectId !== to.projectId) throw new Error('只能对比同一个项目下的需求版本')
}
