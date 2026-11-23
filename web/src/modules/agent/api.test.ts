import assert from 'node:assert/strict'
import { test } from 'node:test'
import { streamAgentChat } from './api'

test('stream events preserve failures, callbacks and a final event without trailing newline', async () => {
  const original = globalThis.fetch
  const payload = { projectId: 'project', requirementId: 'requirement', messages: [{ role: 'user' as const, content: '修改用例' }] }
  const response = (events: unknown[]) => new Response(events.map(event => 'data: ' + JSON.stringify(event)).join('\n\n'))
  try {
    globalThis.fetch = async () => response([{ type: 'delta', delta: '结果' }, { type: 'done', message: '已保存', actions: [] }])
    const result = await streamAgentChat(payload, () => {})
    assert.equal(result.message, '已保存')
    globalThis.fetch = async () => response([{ type: 'error', error: '保存失败' }])
    await assert.rejects(streamAgentChat(payload, () => {}), /保存失败/)
    globalThis.fetch = async () => response([{ type: 'delta', delta: '部分回复' }])
    await assert.rejects(streamAgentChat(payload, () => {}), /尚未收到完成结果/)
    globalThis.fetch = async () => response([{ type: 'done', message: '已保存', actions: [] }])
    await assert.rejects(streamAgentChat(payload, () => { throw new Error('页面同步失败') }), /页面同步失败/)
  } finally { globalThis.fetch = original }
})
