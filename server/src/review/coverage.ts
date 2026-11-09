import type { Chunk, TestCase } from '../store/schema.js'

export interface CoverageRow {
  reqId: string
  sectionPath: string
  caseIds: string[]
  /** 该条款是否需要测试用例；背景说明、纯接口列表这类为 false，不计入覆盖率 */
  testable: boolean
}

/**
 * 需求条款覆盖矩阵（确定性）
 * 每个 reqId 被哪些用例引用；一条都没被引用的即为遗漏候选
 *
 * 注意：覆盖率只在「可测条款」上计算。把背景说明、纯接口定义算进分母，
 * 会让覆盖率永远到不了 100%，也会和遗漏清单的过滤规则打架。
 */
export function buildCoverage(chunks: Chunk[], cases: TestCase[]): { rows: CoverageRow[]; rate: number } {
  const map = new Map<string, Set<string>>()
  for (const c of chunks) map.set(c.reqId, new Set())

  for (const c of cases) {
    for (const ev of c.evidence) {
      const bucket = map.get(ev.reqId)
      if (bucket) bucket.add(c.id)
    }
  }

  const rows: CoverageRow[] = chunks.map((c) => ({
    reqId: c.reqId,
    sectionPath: c.sectionPath,
    caseIds: [...(map.get(c.reqId) ?? [])],
    testable: !isNonTestableChunk(c),
  }))

  const testable = rows.filter((r) => r.testable)
  const covered = testable.filter((r) => r.caseIds.length > 0).length
  return { rows, rate: testable.length ? covered / testable.length : 0 }
}

/** 各类场景的数量分布 */
export function categoryStats(cases: TestCase[]): Record<string, number> {
  const out: Record<string, number> = { normal: 0, abnormal: 0, boundary: 0, permission: 0 }
  for (const c of cases) out[c.category] = (out[c.category] ?? 0) + 1
  return out
}

/** 章节标题一看就是说明性内容的，直接判定无需用例 */
const NON_TESTABLE_TITLE: RegExp[] = [
  /^(文档|需求)?(背景|概述|前言|引言|总述|简介)/,
  /^(适用)?范围$/,
  /^(术语|名词)(解释|定义)?/,
  /^修订(记录|历史)/,
  /^(参考|引用)(资料|文档)/,
  /^目录$/,
]

/**
 * 判断某条款是不是「纯接口定义 / 代码块」这类不需要功能用例的内容。
 * 这类条款出现在遗漏清单里会让报告显得很外行。
 *
 * 除了代码块，还要认章节标题：像「1 背景与范围」这种条款正文是纯叙述，
 * 光靠内容判断不出来，模型又经常一边把它列进遗漏、一边在理由里写「不需要用例」，
 * 所以这里用标题前缀硬性排除。
 */
export function isNonTestableChunk(chunk: Chunk): boolean {
  const rawTitle = chunk.sectionPath.split('/').pop()?.trim() ?? ''
  const title = rawTitle.replace(/^[\d.、\s（(]+/, '').replace(/[)）\s]+$/, '')
  if (title && title.length <= 15 && NON_TESTABLE_TITLE.some((re) => re.test(title))) return true

  const t = chunk.text.trim()
  if (t.startsWith('```')) return true
  const lines = t.split('\n').filter((l) => l.trim())
  if (!lines.length) return true
  const apiLines = lines.filter((l) => /^(GET|POST|PUT|PATCH|DELETE)\s+\//.test(l.trim()))
  return apiLines.length >= Math.ceil(lines.length * 0.6)
}

/** 场景完整性打分（1-5）：四类都覆盖且数量均衡得高分 */
export function scoreCompleteness(cases: TestCase[]): number {
  if (!cases.length) return 1
  const stats = categoryStats(cases)
  const kinds = Object.values(stats).filter((n) => n > 0).length
  const min = Math.min(...Object.values(stats))
  let score = kinds
  if (min >= 1) score += 1
  if (min >= 2) score += 1
  return Math.max(1, Math.min(5, score))
}
