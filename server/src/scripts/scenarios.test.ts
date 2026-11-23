import assert from 'node:assert/strict'
import { test } from 'node:test'
import { batchFillSchema, expandScenarios, extractConstraint, renderScenarioCase } from '../modules/cases/scenarios.js'
import type { Chunk, TestPoint } from '../store/schema.js'

const chunks: Chunk[] = [
  { reqId: 'REQ-001', sectionPath: '查询 / 数量', text: '查询数量必须 <= 20，超过上限时拒绝查询，提示“超出上限”。', order: 0 },
]

function point(overrides: Partial<TestPoint> = {}): TestPoint {
  return {
    id: 'point_a', title: '查询数量上限', category: 'boundary',
    objective: '验证超过 20 条时拒绝查询',
    evidence: [{ reqId: 'REQ-001', quote: '查询数量必须 <= 20，超过上限时拒绝查询，提示“超出上限”。', matched: true }],
    questions: [], status: 'confirmed',
    review: { actor: 'human', reviewer: '核对人', at: '2026-11-23T00:00:00Z', comment: '' },
    ...overrides,
  }
}

test('数值约束只从原文提取，范围必须带单位，日期不误判', () => {
  assert.deepEqual(extractConstraint('查询数量必须 <= 20，超过上限时拒绝查询。'), { lower: undefined, upper: 20, unit: '' })
  assert.deepEqual(extractConstraint('账号长度 6-20 位'), { lower: 6, upper: 20, unit: '位' })
  assert.deepEqual(extractConstraint('密码至少 8 位'), { lower: 8, upper: undefined, unit: '位' })
  assert.deepEqual(extractConstraint('连续输错 5 次锁定账号'), { count: 5, unit: '次' })
  assert.equal(extractConstraint('发布于 2026-11-23，版本 3.1'), null)
  assert.equal(extractConstraint('支持账号登录'), null)
})

test('场景骨架是纯函数：同一测试点展开结果完全一致', () => {
  const p = point()
  assert.deepEqual(expandScenarios(p), expandScenarios(p))
  const boundary = expandScenarios(p)
  assert.deepEqual(boundary.map(s => s.kind), ['at-upper', 'above-upper'])
  assert.deepEqual(boundary.map(s => s.constraint!.expectedValue), [20, 21])
  assert.deepEqual(boundary.map(s => s.id), ['point_a:at-upper', 'point_a:above-upper'])

  const range = expandScenarios(point({ evidence: [{ reqId: 'REQ-001', quote: '账号长度 6-20 位', matched: true }] }))
  assert.deepEqual(range.map(s => s.constraint!.expectedValue), [6, 5, 20, 21])

  const noConstraint = expandScenarios(point({ evidence: [{ reqId: 'REQ-001', quote: '支持账号登录', matched: true }] }))
  assert.deepEqual(noConstraint.map(s => s.kind), ['boundary-clarify'])

  const permission = expandScenarios(point({ category: 'permission', objective: '验证未登录不能查询' }))
  assert.deepEqual(permission.map(s => s.kind), ['authorized', 'denied', 'unauthenticated'])

  const normal = expandScenarios(point({ category: 'normal', methods: ['状态迁移'] }))
  assert.deepEqual(normal.map(s => s.kind), ['main-flow', 'state-transition'])
  assert.deepEqual(expandScenarios(point({ category: 'abnormal' })).map(s => s.kind), ['reject-path'])
})

test('槽位校验拦截增删场景、改数值、编造提示和含糊预期', () => {
  const scenarios = expandScenarios(point())
  const valid = {
    scenarioId: scenarios[1].id, subject: '查询数量', input: '提交 21 条查询', action: '提交查询请求',
    expected: '查询被拒绝', message: '超出上限', steps: [], assumptions: [],
  }
  const ok = batchFillSchema(scenarios, chunks).safeParse({ scenarios: [
    { ...valid, scenarioId: scenarios[0].id, input: '提交 20 条查询', expected: '查询成功返回记录' },
    valid,
  ] })
  assert.equal(ok.success, true)

  const fail = (fill: Record<string, unknown>, pattern: RegExp) => {
    const result = batchFillSchema(scenarios, chunks).safeParse({ scenarios: [
      { ...valid, scenarioId: scenarios[0].id, input: '提交 20 条查询', expected: '查询成功返回记录' },
      { ...valid, ...fill },
    ] })
    assert.equal(result.success, false)
    assert.match(JSON.stringify(result.error!.issues), pattern)
  }
  fail({ input: '提交 22 条查询' }, /必须包含骨架给定取值 21/)
  fail({ message: '系统繁忙请稍后再试' }, /逐字来自条款原文/)
  fail({ expected: '显示正常' }, /必须可判定/)
  fail({ scenarioId: 'point_a:made-up' }, /骨架外场景/)

  const missing = batchFillSchema(scenarios, chunks).safeParse({ scenarios: [valid] })
  assert.equal(missing.success, false)
  assert.match(JSON.stringify(missing.error!.issues), /遗漏场景/)

  const flow = expandScenarios(point({ category: 'normal' }))
  const noSteps = batchFillSchema(flow, chunks).safeParse({ scenarios: [{ ...valid, scenarioId: flow[0].id, steps: [] }] })
  assert.equal(noSteps.success, false)
})

test('模板渲染：结构由骨架决定，缺提示自动记缺口，待澄清不给确定结论', () => {
  const scenarios = expandScenarios(point())
  const fill = {
    scenarioId: scenarios[1].id, precondition: '', subject: '查询数量', input: '提交 21 条查询',
    action: '提交查询请求', expected: '查询被拒绝', message: '超出上限', assumptions: [],
  }
  const rendered = renderScenarioCase(scenarios[1], fill, point(), { projectId: 'p', requirementId: 'r', chunks, titleSuffix: scenarios[1].label })
  assert.equal(rendered.title, '查询数量上限（上界+1（21））')
  assert.deepEqual(rendered.steps, ['构造查询数量：提交 21 条查询', '提交查询请求'])
  assert.deepEqual(rendered.expected, ['查询被拒绝', '提示/返回：超出上限'])
  assert.equal(rendered.category, 'boundary')
  assert.equal(rendered.module, '数量')
  assert.equal(rendered.evidence[0].quoteMatch, 'exact')

  const noMessage = renderScenarioCase(scenarios[1], { ...fill, message: '' }, point(), { projectId: 'p', requirementId: 'r', chunks })
  assert(noMessage.assumptions.some(a => a.includes('具体提示内容')))

  const clarify = expandScenarios(point({ evidence: [{ reqId: 'REQ-001', quote: '支持账号登录', matched: true }] }))[0]
  const clarifyCase = renderScenarioCase(clarify, { ...fill, scenarioId: clarify.id, expected: '查询被拒绝' }, point(), { projectId: 'p', requirementId: 'r', chunks })
  assert.deepEqual(clarifyCase.expected, ['需求未明确，待业务确认实际处理结果'])
  assert.equal(clarifyCase.priority, 'P2')
})