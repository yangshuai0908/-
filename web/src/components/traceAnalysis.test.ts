import assert from 'node:assert/strict'
import { test } from 'node:test'
import { traceSections, traceSectionTitles } from './traceAnalysis'

test('trace analysis display preserves content and does not invent validation or confirmation', () => {
  const analysis = {
    sections: [{ reqId: 'REQ-006', points: [{
      title: 'token有效期', category: 'normal', objective: '验证token的有效期（待安全评审后确认）',
      evidence: [{ reqId: 'REQ-006', quote: 'token 有效期待定，待安全评审后确认。' }],
      questions: ['token的具体有效期是多少？'],
    }], questions: [], notTestableReason: '' }],
  }
  const original = JSON.stringify(analysis)
  for (const value of [analysis, original, { content: original, finishReason: 'stop' }, { analysis }]) {
    const sections = traceSections(value)!
    assert.equal(sections[0].points[0].status, undefined)
    assert.equal(sections[0].points[0].evidence[0].matched, undefined)
    assert.equal(sections[0].points[0].questions[0], 'token的具体有效期是多少？')
    assert.deepEqual(sections, analysis.sections)
  }
  assert.equal(JSON.stringify(analysis), original)
  assert.deepEqual(traceSections({ sections: [] }), [])
  for (const value of [null, '普通文本', '{invalid', {}, { sections: [analysis.sections[0], { reqId: 'REQ-007', points: [] }] }]) {
    assert.equal(traceSections(value), null)
  }
  const recorded = structuredClone(analysis)
  Object.assign(recorded.sections[0].points[0], { status: 'confirmed' })
  Object.assign(recorded.sections[0].points[0].evidence[0], { matched: false })
  assert.equal(traceSections(recorded)![0].points[0].status, 'confirmed')
  assert.equal(traceSections(recorded)![0].points[0].evidence[0].matched, false)
  assert.deepEqual(traceSectionTitles({ requirement: { chunks: [{ reqId: 'REQ-006', sectionPath: '账号登录 / 会话' }] } }), { 'REQ-006': '账号登录 / 会话' })
  assert.deepEqual(traceSectionTitles(null), {})
})
