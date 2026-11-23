import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readHistory, serializeHistory, startNewSession } from './history'

test('chat history works when crypto or randomUUID is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  try {
    for (const crypto of [undefined, {}]) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto })
      const history = readHistory(JSON.stringify([{ role: 'user', content: '已有消息' }]))
      const next = startNewSession(history)
      assert.ok(history.activeId)
      assert.notEqual(next.activeId, history.activeId)
      assert.equal(readHistory(serializeHistory(next)).sessions[1].turns[0].content, '已有消息')
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original)
    else Reflect.deleteProperty(globalThis, 'crypto')
  }
})

test('new chat keeps migrated history, tool results and all messages across reloads', () => {
  const legacy = Array.from({ length: 60 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `消息 ${index}`,
    actions: index % 2 ? [{ tool: 'read_requirement', title: '读取条款', data: { reqId: 'REQ-001' } }] : [],
  }))
  const oldHistory = readHistory(JSON.stringify(legacy))
  const oldId = oldHistory.activeId
  const next = startNewSession(oldHistory)
  assert.notEqual(next.activeId, oldId)
  assert.equal(next.sessions[0].turns.length, 0)
  assert.deepEqual(oldHistory.sessions[0].turns, legacy)
  next.sessions[0].turns.push({ role: 'user', content: '新问题' })
  const restored = readHistory(serializeHistory(next))
  assert.equal(restored.activeId, next.activeId)
  assert.equal(restored.sessions.length, 2)
  assert.deepEqual(restored.sessions.find(session => session.id === oldId)!.turns, legacy)
  restored.activeId = oldId
  assert.equal(readHistory(serializeHistory(restored)).activeId, oldId)
  // 流式请求结束后仍保存到发起请求的会话，不串到后来打开的会话。
  oldHistory.sessions[0].turns.push({ role: 'assistant', content: '原请求完成' })
  assert.equal(next.sessions[1].turns.at(-1)!.content, '原请求完成')
  assert.equal(next.sessions[0].turns.length, 1)
})
