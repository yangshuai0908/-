import { diffChunks } from '../../docs/diff.js'
import type { Chunk, RequirementAnalysis, RequirementVersion } from '../../store/schema.js'
import { genId, nowIso } from '../../utils.js'
import { locateAnalysisEvidence, pointSourceHash, sectionInputHash } from './analysis.js'

export interface InheritanceStats {
  fromId: string
  fromLabel: string
  sections: number
  points: number
  confirmed: number
  totalChunks: number
}

/**
 * 上传新版本时继承上一版本未变条款的分析结果（确定性，不调模型）。
 * - 条款按 docs/diff 判定"未实质变化"才继承
 * - 测试点的引用必须全部落在未变条款上，否则整节留给重新分析
 * - 引用在新正文中不再逐字匹配时降级为待确认，人工确认不能悄悄跨版本生效
 */
export function inheritAnalysis(
  prev: RequirementVersion,
  chunks: Chunk[],
): { analysis: RequirementAnalysis; stats: InheritanceStats } | null {
  if (!prev.analysis) return null
  const diff = diffChunks(prev.chunks, chunks)
  const unchanged = new Map<string, string>()
  for (const change of diff.changes) {
    if (change.type === 'unchanged' && change.fromReqId && change.toReqId) unchanged.set(change.fromReqId, change.toReqId)
  }
  if (!unchanged.size) return null

  const sections: RequirementAnalysis['sections'] = []
  let points = 0
  let confirmed = 0
  for (const [fromReqId, toReqId] of unchanged) {
    const old = prev.analysis.sections.find((section) => section.reqId === fromReqId)
    const chunk = chunks.find((c) => c.reqId === toReqId)
    if (!old || !chunk) continue
    const remapped: RequirementAnalysis['sections'][number]['points'] = []
    let inheritable = true
    for (const point of old.points) {
      if (!point.evidence.every((e) => unchanged.has(e.reqId))) {
        inheritable = false
        break
      }
      const evidence = locateAnalysisEvidence(chunks, point.evidence.map((e) => ({ reqId: unchanged.get(e.reqId)!, quote: e.quote })))
      const allMatched = evidence.length > 0 && evidence.every((e) => e.matched)
      // 指纹按新编号重算，之后强制重分析给出相同结果时仍能找回这份人工结论
      const sourceHash = pointSourceHash({ title: point.title, category: point.category, objective: point.objective, questions: point.questions, methods: point.methods, rationale: point.rationale, evidence })
      remapped.push({ ...point, evidence, sourceHash, status: allMatched ? point.status : 'pending' })
    }
    if (!inheritable) continue
    sections.push({ ...old, reqId: toReqId, points: remapped, inputHash: sectionInputHash(chunk) })
    points += remapped.length
    confirmed += remapped.filter((point) => point.status === 'confirmed').length
  }
  if (!sections.length) return null
  const timestamp = nowIso()
  return {
    analysis: { id: genId('analysis'), createdAt: timestamp, updatedAt: timestamp, sections },
    stats: { fromId: prev.id, fromLabel: prev.label, sections: sections.length, points, confirmed, totalChunks: chunks.length },
  }
}