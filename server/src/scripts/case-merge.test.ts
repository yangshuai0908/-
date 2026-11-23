import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTwoCases, mergeCaseGroup, mergeAllDuplicates } from '../modules/review/dedupe.js'
import type { TestCase } from '../store/schema.js'
import { blankAssessment } from '../store/schema.js'

function makeCase(id: string, title: string, opts: Partial<TestCase> = {}): TestCase {
  return {
    id,
    projectId: 'p1',
    requirementId: 'req1',
    title,
    category: 'normal',
    priority: 'P1',
    module: '用户中心',
    precondition: '已注册账号',
    steps: ['提交账号密码', '观察结果'],
    expected: ['登录成功', '进入系统'],
    evidence: [{ reqId: 'REQ-001', quote: '支持账号登录' }],
    assumptions: ['假设网络通畅'],
    businessConfirmation: '',
    businessConfirmer: '',
    assessment: blankAssessment(),
    origin: 'generated',
    updatedAt: new Date().toISOString(),
    source: {
      runId: 'r1',
      analysisId: 'a1',
      analysisUpdatedAt: '2026-11-12T00:00:00Z',
      pointId: `point_${id}`,
      title,
      objective: title,
      reqIds: ['REQ-001'],
    },
    ...opts,
  }
}

test('duplicate case merging', async (t) => {
  await t.test('mergeTwoCases combines evidence, assumptions, steps and point references', () => {
    const caseA = makeCase('c1', '登录-正常-使用账号登录成功跳转用户中心首页', {
      evidence: [{ reqId: 'REQ-001', quote: '支持账号登录' }],
      steps: ['在登录页输入账号密码', '点击登录按钮'],
      expected: ['登录成功', '跳转到首页'],
    })
    const caseB = makeCase('c2', '登录-正常-使用绑定手机号登录成功跳转用户中心首页', {
      evidence: [{ reqId: 'REQ-002', quote: '支持绑定手机号登录' }],
      steps: ['在登录页输入手机号和密码', '点击登录按钮'],
      expected: ['登录成功', '跳转到首页'],
      assumptions: ['手机号已激活'],
    })

    const merged = mergeTwoCases(caseA, caseB)

    assert.equal(merged.id, 'c1')
    assert.ok(merged.title.includes('账号或绑定手机号登录'))
    assert.equal(merged.evidence.length, 2)
    assert.deepEqual(merged.evidence.map(e => e.reqId), ['REQ-001', 'REQ-002'])
    assert.ok(merged.assumptions.includes('手机号已激活'))
    assert.ok(merged.source?.reqIds.includes('REQ-002'))
    assert.ok(merged.source?.mergedPointIds?.includes('point_c2'))
  })

  await t.test('mergeCaseGroup picks the best primary case and identifies removedIds', () => {
    const case1 = makeCase('c1', '账号状态变更-正常-停用账号后该账号已签发token立即失效', {
      evidence: [{ reqId: 'REQ-010', quote: '停用账号后已签发token失效' }],
    })
    const case2 = makeCase('c2', '账号状态变更-正常-停用账号后该账号多个已签发token均失效', {
      priority: 'P0',
      evidence: [{ reqId: 'REQ-010', quote: '停用账号后已签发token失效' }],
    })

    const result = mergeCaseGroup([case1, case2], ['c1', 'c2'])
    assert.ok(result)
    // case2 has priority P0, so it should be primary
    assert.equal(result.merged.id, 'c2')
    assert.deepEqual(result.removedIds, ['c1'])
  })

  await t.test('mergeAllDuplicates processes all candidates above threshold', () => {
    const case1 = makeCase('c1', '登录-正常-使用账号登录成功跳转用户中心首页', {
      evidence: [{ reqId: 'REQ-001', quote: '支持账号登录' }],
    })
    const case2 = makeCase('c2', '登录-正常-使用绑定手机号登录成功跳转用户中心首页', {
      evidence: [{ reqId: 'REQ-001', quote: '支持账号登录' }],
    })
    const case3 = makeCase('c3', '无关用例-正常-修改密码成功', {
      module: '安全中心',
      precondition: '已登录',
      steps: ['输入旧密码', '输入新密码'],
      expected: ['修改成功'],
      evidence: [{ reqId: 'REQ-003', quote: '修改密码' }],
    })

    const result = mergeAllDuplicates([case1, case2, case3], 0.7)
    assert.equal(result.removedIds.length, 1)
    assert.equal(result.mergedCases.length, 1)
    assert.ok(!result.removedIds.includes('c3'))
  })
})
