import type { Chunk, Evidence } from '../store/schema.js'

/**
 * 归一化白名单：汉字 / 数字 / 小写字母 / 连字符
 * 注意顺序 —— 必须先把区间符号统一成 "-"，再按白名单过滤，
 * 否则 "6-20位" 的连字符会在过滤阶段被丢掉，和 "6至20位" 对不上。
 */
const ALLOW = (cp: number): boolean =>
  (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 48 && cp <= 57) || (cp >= 97 && cp <= 122) || cp === 45

export function normalize(raw: string): string {
  const unified = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[~至到—–－〜]/g, '-')
  let out = ''
  for (const ch of unified) {
    const cp = ch.codePointAt(0)
    if (cp !== undefined && ALLOW(cp)) out += ch
  }
  return out
}

/** 抽取数值 token（含区间，如 8-32） */
export function numeralsOf(text: string): Set<string> {
  const out = new Set<string>()
  const re = /\d+(?:-\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.add(m[0])
  return out
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

function dice(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return (2 * inter) / (A.size + B.size)
}

function levenshtein(a: string, b: string): number {
  const n = a.length
  const m = b.length
  if (!n) return m
  if (!m) return n
  let prev = Array.from({ length: m + 1 }, (_, j) => j)
  let cur = new Array<number>(m + 1)
  for (let i = 1; i <= n; i++) {
    cur[0] = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const t = prev
    prev = cur
    cur = t
  }
  return prev[m]
}

function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length)
  return len ? 1 - levenshtein(a, b) / len : 0
}

/** 3-gram 倒排索引，用于快速定位候选窗口 */
function buildIndex(normText: string): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (let i = 0; i + 3 <= normText.length; i++) {
    const g = normText.slice(i, i + 3)
    const arr = index.get(g)
    if (!arr) index.set(g, [i])
    else if (arr.length < 200) arr.push(i)
  }
  return index
}

interface CachedChunk {
  norm: string
  index: Map<string, number[]>
  numerals: Set<string>
}

const cache = new Map<string, CachedChunk>()

function getCached(chunk: Chunk): CachedChunk {
  const key = `${chunk.reqId}\0${chunk.text}`
  const hit = cache.get(key)
  if (hit) return hit
  const norm = normalize(chunk.text)
  const entry: CachedChunk = { norm, index: buildIndex(norm), numerals: numeralsOf(norm) }
  cache.set(key, entry)
  return entry
}

/** 在原文中滑动找最佳匹配窗口（3 档窗口长度 + Dice 粗筛，再 Levenshtein 精修） */
function bestWindow(normText: string, index: Map<string, number[]>, qNorm: string): { score: number; text: string } {
  const L = qNorm.length
  let best = 0
  let bestSlice = ''

  const seeds: { off: number; df: number; pos: number[] }[] = []
  for (let i = 0; i + 3 <= qNorm.length; i++) {
    const g = qNorm.slice(i, i + 3)
    const pos = index.get(g)
    seeds.push({ off: i, df: pos ? pos.length : 0, pos: pos ?? [] })
  }
  seeds.sort((a, b) => a.df - b.df)
  const usable = seeds.filter((s) => s.df > 0).slice(0, 6)

  for (const seed of usable) {
    for (const p of seed.pos) {
      for (const w of [Math.round(L * 0.85), L, Math.round(L * 1.15)]) {
        const start = Math.max(0, p - seed.off)
        const end = Math.min(normText.length, start + w)
        const slice = normText.slice(start, end)
        const d = dice(slice, qNorm)
        if (d > best) {
          best = d
          bestSlice = slice
        }
      }
    }
  }

  // 粗筛过了 0.6 再用编辑距离精修一次
  if (best >= 0.6 && bestSlice) best = Math.max(best, similarity(bestSlice, qNorm))
  return { score: best, text: bestSlice }
}

/** 未定位时，在原文里找最相近的句子，作为「建议替换」提示 */
function relocate(chunk: Chunk, quote: string): string | undefined {
  const sentences = chunk.text
    .split(/(?<=[。！？；\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6)
  let best = 0
  let bestSentence: string | undefined
  for (const s of sentences) {
    const sc = similarity(normalize(s), normalize(quote))
    if (sc > best) {
      best = sc
      bestSentence = s
    }
  }
  return best >= 0.45 ? bestSentence : undefined
}

/**
 * 证据溯源校验（核心防编造）
 * ① 精确子串命中 → exact
 * ② 数值 token 不在原文数值集合 → 直接 unverified（抓篡改阈值）
 * ③ 相似度 ≥0.75 fuzzy，≥0.5 fuzzy（弱），其余 unverified
 */
export function verifyEvidence(chunk: Chunk | undefined, evidence: { reqId: string; quote: string }): Evidence {
  const { reqId, quote } = evidence
  const base: Evidence = {
    reqId, quote, state: 'unknown', quoteMatch: 'missing',
    conditionSupport: 'unknown', expectedSupport: 'unknown',
    sectionPath: chunk?.sectionPath, score: 0, reason: '',
  }

  if (!chunk) return { ...base, reason: `条款 ${reqId} 不存在于当前需求版本` }

  const qNorm = normalize(quote)
  if (qNorm.length < 4) return { ...base, reason: '引用片段过短，无法溯源' }

  const cached = getCached(chunk)

  if (cached.norm.includes(qNorm)) {
    return { ...base, quoteMatch: 'exact', score: 1, reason: '原文片段已定位；待核对测试条件和预期' }
  }

  const missing = [...numeralsOf(qNorm)].filter((n) => !cached.numerals.has(n))
  if (missing.length) {
    return {
      ...base,
      state: 'unknown',
      score: 0,
      reason: `数值 ${missing.join('、')} 不存在于该条款原文`,
      relocated: relocate(chunk, quote),
    }
  }

  const { score } = bestWindow(cached.norm, cached.index, qNorm)
  if (score >= 0.75) {
    return { ...base, quoteMatch: 'fuzzy', score, reason: '引用与原文相近，待核对测试结论' }
  }
  if (score >= 0.55) {
    return {
      ...base,
      quoteMatch: 'fuzzy',
      score,
      reason: '弱匹配，建议人工核对依据',
      relocated: relocate(chunk, quote),
    }
  }
  return {
    ...base,
    state: 'unknown',
    score,
    reason:
      score >= 0.4
        ? `依据与原文仅部分吻合（相似度 ${score.toFixed(2)}），关键内容可能被改动`
        : '依据未在该条款原文中定位',
    relocated: relocate(chunk, quote),
  }
}

/** 批量校验，一次建好全部 chunk 的索引 */
export function verifyEvidenceList(
  chunks: Chunk[],
  list: { reqId: string; quote: string }[],
): Evidence[] {
  const byId = new Map(chunks.map((c) => [c.reqId, c]))
  for (const c of chunks) getCached(c)
  return list.map((ev) => verifyEvidence(byId.get(ev.reqId), ev))
}

/** 多条引用可共同支持条件与预期；仍要求每条引用都能定位。 */
export function overallState(evidence: Evidence[]): 'explicit' | 'inferred' | 'unknown' {
  if (!evidence.length) return 'unknown'
  if (evidence.some((e) => e.quoteMatch === 'missing' || !['explicit', 'inferred', 'unknown'].includes(e.state))) return 'unknown'
  const condition = evidence.some((e) => e.conditionSupport === 'explicit') ? 'explicit'
    : evidence.some((e) => e.conditionSupport === 'inferred') ? 'inferred' : 'unknown'
  const expected = evidence.some((e) => e.expectedSupport === 'explicit') ? 'explicit'
    : evidence.some((e) => e.expectedSupport === 'inferred') ? 'inferred' : 'unknown'
  if (condition === 'unknown' || expected === 'unknown') return 'unknown'
  return condition === 'explicit' && expected === 'explicit' && evidence.every((e) => e.quoteMatch === 'exact')
    ? 'explicit' : 'inferred'
}

export function clearEvidenceCache(): void {
  cache.clear()
}
