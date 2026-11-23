import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCoverageReport } from '../modules/cases/coverage.js'
import { blankAssessment, type Chunk, type RequirementVersion, type TestCase, type TestPoint } from '../store/schema.js'
import type { WorkflowTrace } from '../trace.js'

const chunks: Chunk[] = [
  { reqId: 'REQ-001', sectionPath: '查询 / 数量', text: '查询数量必须 <= 20，超过上限时拒绝查询，提示“超出上限”。', order: 0 },
]

function point(id: string, overrides: Partial<TestPoint> = {}): TestPoint {
  return {
    id, title: id === 'point_a' ? '查询数量上限' : '执行查询', category: id === 'point_a' ? 'boundary' : 'normal',
    objective: id === 'point_a' ? '验证超过 20 条时拒绝查询' : '按正常条件完成查询',
    evidence: [{ reqId: 'REQ-001', quote: '查询数量必须 <= 20，超过上限时拒绝查询，提示“超出上限”。', matched: true }],
    questions: [], status: 'confirmed',
    review: { actor: 'human', reviewer: '核对人', at: '2026-11-23T00:00:00Z', comment: '' },
    ...overrides,
  }
}

function requirement(points: TestPoint[]): RequirementVersion {
  return {
    id: 'req1', projectId: 'p1', label: '查询需求', rawText: '', sourceType: 'txt', apiList: [],
    chunks, createdAt: '2026-11-23T00:00:00Z',
    analysis: { id: 'an1', createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:01Z', sections: [{ reqId: 'REQ-001', points, questions: [], notTestableReason: '' }] },
  }
}

function generatedCase(id: string, pointId: string, scenarioId: string, analysisId = 'an1'): TestCase {
  return {
    id, projectId: 'p1', requirementId: 'req1', title: id, category: 'boundary', priority: 'P1',
    module: '数量', precondition: '', steps: [], expected: [], evidence: [], assumptions: [],
    businessConfirmation: '', businessConfirmer: '', assessment: blankAssessment(),
    origin: 'generated', updatedAt: '2026-11-23T00:00:02Z',
    source: {
      runId: 'run1', analysisId, analysisUpdatedAt: '', pointId,
      title: '', objective: '', reqIds: ['REQ-001'], scenarioId, scenarioKind: '',
    },
  }
}

function trace(overrides: Partial<WorkflowTrace> = {}): WorkflowTrace {
  return {
    id: 'run1', requirementId: 'req1', projectId: 'p1', kind: 'generation', status: 'succeeded',
    startedAt: '2026-11-23T00:00:03Z', model: '', input: null, output: null, caseIds: [], steps: [],
    ...overrides,
  }
}

test('覆盖报告：covered / stale / missing 三态与汇总计数', () => {
  const req = requirement([point('point_a'), point('point_b')])
  const cases = [
    generatedCase('case1', 'point_a', 'point_a:at-upper'),
    generatedCase('case2', 'point_b', 'point_b:main-flow', 'an0'),
  ]
  const report = buildCoverageReport(req, cases, [])
  const byId = new Map(report.points.flatMap(p => p.scenarios.map(s => [s.scenarioId, s])))
  assert.equal(byId.get('point_a:at-upper')?.status, 'covered')
  assert.deepEqual(byId.get('point_a:at-upper')?.caseIds, ['case1'])
  assert.equal(byId.get('point_a:above-upper')?.status, 'missing')
  assert.equal(byId.get('point_a:above-upper')?.reason, '该场景的用例在生成后被人工删除，可重新生成补齐')
  assert.equal(byId.get('point_b:main-flow')?.status, 'stale')
  assert.match(byId.get('point_b:main-flow')?.reason ?? '', /旧版分析/)
  assert.deepEqual(report.summary, { points: 2, scenarios: 3, covered: 1, stale: 1, missing: 1, pending: 0, excluded: 0 })
})

test('缺口原因优先采用最近一次生成的合并/去重记录，且只认当前分析', () => {
  const req = requirement([point('point_a')])
  const old = trace({
    id: 'run_old', startedAt: '2026-11-23T00:00:01Z',
    input: { requirement: { analysis: { id: 'an0' } } },
    output: { skipped: [{ title: '查询数量上限（上界+1（21））', pointId: 'point_a', reason: '与已有用例完全相同，已自动去重' }] },
  })
  const current = trace({
    id: 'run_new', startedAt: '2026-11-23T00:00:05Z',
    input: { requirement: { analysis: { id: 'an1' } } },
    output: { skipped: [{ title: '查询数量上限（上界+1（21））', pointId: 'point_a', reason: '与「查询数量上限」高度重合（相似度 91%），已直接合并' }] },
  })
  const report = buildCoverageReport(req, [generatedCase('case1', 'point_a', 'point_a:at-upper')], [old, current])
  const aboveUpper = report.points[0].scenarios.find(s => s.scenarioId === 'point_a:above-upper')!
  assert.match(aboveUpper.reason ?? '', /相似度 91%/)
})

test('测试点从未生成、pending 与 excluded 点不进入覆盖对账', () => {
  const req = requirement([
    point('point_a'),
    point('point_b', { status: 'pending' }),
    point('point_c', { status: 'excluded' }),
  ])
  const report = buildCoverageReport(req, [], [])
  assert.equal(report.summary.points, 1)
  assert.equal(report.summary.pending, 1)
  assert.equal(report.summary.excluded, 1)
  assert.equal(report.summary.missing, 2)
  const reasons = report.points[0].scenarios.map(s => s.reason)
  assert.ok(reasons.every(reason => reason === '该测试点尚未生成用例'))
})
