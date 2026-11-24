import type { CoverageReport, PointCoverage, ScenarioCoverage } from '@testpilot/shared'
import { generationPlan } from './generation.js'
import type { RequirementVersion, TestCase } from '../../store/schema.js'
import { CATEGORIES } from '../../utils.js'
import type { WorkflowTrace } from '../../trace.js'

interface SkippedRecord { title: string; pointId: string; reason: string }

/** 找出当前分析对应、时间最近的一次生成追溯，其 output.skipped 记录了被合并/去重的候选标题 */
function latestSkipped(traces: WorkflowTrace[], analysisId: string): SkippedRecord[] {
  const runs = traces
    .filter(run => run.kind === 'generation')
    .filter(run => (run.input as { requirement?: { analysis?: { id?: string } } } | undefined)?.requirement?.analysis?.id === analysisId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return (runs[0]?.output as { skipped?: SkippedRecord[] } | undefined)?.skipped ?? []
}

/**
 * 反向覆盖报告：按当前已确认测试点重算场景骨架，与已保存用例的 source.scenarioId 对账。
 * covered = 当前分析生成的用例存在；stale = 只有旧分析生成的用例；missing = 无任何用例，
 * 原因优先取最近一次生成时被合并/去重的记录，其次区分“从未生成”和“生成后被删除”。
 */
export function buildCoverageReport(requirement: RequirementVersion, cases: TestCase[], traces: WorkflowTrace[]): CoverageReport {
  const analysis = requirement.analysis!
  const plan = generationPlan(requirement, [...CATEGORIES])
  const skipped = latestSkipped(traces, analysis.id)

  const casesByPoint = new Map<string, TestCase[]>()
  for (const c of cases) {
    if (!c.source) continue
    const list = casesByPoint.get(c.source.pointId) ?? []
    list.push(c)
    casesByPoint.set(c.source.pointId, list)
  }

  const points: PointCoverage[] = plan.points.map(point => {
    const siblings = plan.scenariosByPoint.get(point.id)!
    const pointCases = casesByPoint.get(point.id) ?? []
    const scenarios: ScenarioCoverage[] = siblings.map(scenario => {
      const covered = pointCases.filter(c => c.source!.analysisId === analysis.id && c.source!.analysisUpdatedAt === analysis.updatedAt && c.source!.scenarioId === scenario.id)
      const stale = pointCases.filter(c => (c.source!.analysisId !== analysis.id || c.source!.analysisUpdatedAt !== analysis.updatedAt) && c.source!.scenarioId === scenario.id)
      if (covered.length) {
        return { scenarioId: scenario.id, kind: scenario.kind, label: scenario.label, status: 'covered', caseIds: covered.map(c => c.id) }
      }
      if (stale.length) {
        return { scenarioId: scenario.id, kind: scenario.kind, label: scenario.label, status: 'stale', caseIds: stale.map(c => c.id), reason: '需求分析已更新，该场景的用例仍是旧版分析生成的' }
      }
      // 生成时被合并/去重的候选标题与 renderScenarioCase 的命名规则一致
      const expectedTitle = siblings.length > 1 ? `${point.title}（${scenario.label}）` : point.title
      const skip = skipped.find(item => item.title === expectedTitle)
      const reason = skip?.reason
        ?? (pointCases.length ? '该场景的用例在生成后被人工删除，可重新生成补齐' : '该测试点尚未生成用例')
      return { scenarioId: scenario.id, kind: scenario.kind, label: scenario.label, status: 'missing', caseIds: [], reason }
    })
    return { pointId: point.id, title: point.title, category: point.category, scenarios }
  })

  const all = points.flatMap(point => point.scenarios)
  const covered = all.filter(s => s.status === 'covered').length
  const stale = all.filter(s => s.status === 'stale').length
  const missing = all.filter(s => s.status === 'missing').length
  return {
    analysisId: analysis.id,
    analysisUpdatedAt: analysis.updatedAt,
    summary: {
      points: points.length,
      scenarios: all.length,
      covered,
      stale,
      missing,
      pending: plan.pending,
      excluded: plan.excluded,
    },
    points,
  }
}
