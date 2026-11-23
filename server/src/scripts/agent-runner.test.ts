import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../config.js'
import { runAgentLoop } from '../modules/agent/runner.js'
import { MAX_AGENT_STEPS } from '../modules/agent/prompts.js'
import { toolRegistry } from '../modules/agent/tools/index.js'
import type { AgentRole, AgentStreamEvent, ToolResult } from '../modules/agent/types.js'

test('Agent 持续推进长任务，拦截重复写入，暂停时保留真实结果', async t => {
  const previous = { ...config }, originalFetch = globalThis.fetch
  const originalRead = toolRegistry.read_requirement.execute
  const originalUpdate = toolRegistry.update_case.execute
  Object.assign(config, { apiKey: 'isolated-runner-fixture', baseUrl: 'http://runner-fixture.invalid', model: 'runner-fixed-sample' })
  let modelCalls = 0, reads = 0, writes = 0, disconnected = false
  let requestLog: { messages: { role: string; content: string }[]; stream?: boolean }[] = []
  let decide: (call: number, summary: boolean) => unknown
  let onModelResponse = () => {}
  const reset = () => {
    modelCalls = 0; reads = 0; writes = 0; disconnected = false; requestLog = []
    onModelResponse = () => {}
    toolRegistry.read_requirement.execute = async () => { reads++; return { title: `已读取条款 ${reads}`, data: { reads } } }
    toolRegistry.update_case.execute = async () => { writes++; return { title: `已保存用例修改 ${writes}`, data: { writes }, changes: ['cases'] } }
  }
  const run = async (role: AgentRole = 'team') => {
    const events: AgentStreamEvent[] = []
    await runAgentLoop({
      ctx: { projectId: 'runner-project', currentRequirementId: 'runner-requirement' },
      role,
      messages: [{ role: 'user', content: '完成当前需求的用例处理' }],
      sendEvent: event => events.push(event), isDisconnected: () => disconnected,
    })
    return events
  }
  const doneOf = (events: AgentStreamEvent[]) => {
    const done = events.find(event => event.type === 'done')
    assert(done?.type === 'done'); return done
  }
  globalThis.fetch = async (url, init) => {
    assert(String(url).startsWith('http://runner-fixture.invalid/'))
    const body = JSON.parse(String(init?.body))
    requestLog.push(body)
    const decision = decide(++modelCalls, !body.stream)
    onModelResponse()
    return body.stream
      ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(decision) } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json({ choices: [{ message: { content: JSON.stringify(decision) }, finish_reason: 'stop' }] })
  }
  try {
    await t.test('质量审查员的越界写入在执行前被拦截，角色会传递到工具层', async () => {
      reset()
      decide = call => call === 1
        ? { type: 'tool', tool: 'update_case', args: { caseId: 'case-1', title: '不应由检查操作写入' } }
        : { type: 'final', message: '已列出修改建议，请交由用例设计师修改。' }
      const done = doneOf(await run('reviewer'))
      assert.equal(writes, 0)
      assert.equal(done.actions.length, 1)
      assert.match(done.actions[0].error!, /质量审查员不负责/)
      assert.match(requestLog[0].messages[0].content, /本轮角色：质量审查员/)
    })
    await t.test('超过旧的六次决策仍继续处理并正常完成，不新建请求或丢失上下文', async () => {
      reset()
      decide = call => call <= 8
        ? { type: 'tool', tool: 'read_requirement', args: { keyword: `条款${call}` } }
        : { type: 'final', message: '已完成本轮条款核对，等待人工确认测试点。' }
      const done = doneOf(await run())
      assert.equal(reads, 8); assert.equal(done.actions.length, 8)
      assert.equal(done.message, '已完成本轮条款核对，等待人工确认测试点。')
      assert(requestLog[7].messages.some(m => m.content.includes('"reads":7')))
      assert.equal(modelCalls, 9)
    })
    await t.test('参数顺序不同、可选字段为 null 时也不重复保存相同修改', async () => {
      reset()
      decide = call => call === 1
        ? { type: 'tool', tool: 'update_case', args: { caseId: 'case-1', title: '新标题', evidence: [{ reqId: 'REQ-001', quote: '需求原文' }] } }
        : call === 2
          ? { type: 'tool', tool: 'update_case', args: { evidence: [{ quote: '需求原文', reqId: 'REQ-001' }], title: '新标题', caseId: 'case-1', module: null } }
          : { type: 'final', message: '已保存选中的用例。' }
      const done = doneOf(await run())
      assert.equal(writes, 1); assert.equal(done.actions.length, 1)
      assert.equal(done.actions[0].title, '已保存用例修改 1')
    })
    await t.test('写入改变数据后，允许重新读取相同查询以核对新状态', async () => {
      reset()
      decide = call => call === 2
        ? { type: 'tool', tool: 'update_case', args: { caseId: 'case-1', title: '新标题' } }
        : call <= 3
          ? { type: 'tool', tool: 'read_requirement', args: {} }
          : { type: 'final', message: '修改后已重新读取并核对。' }
      const done = doneOf(await run())
      assert.equal(reads, 2); assert.equal(writes, 1); assert.equal(done.actions.length, 3)
    })
    await t.test('重复空转会结束，汇总继续要求调用工具也不能丢失已经保存的成果', async () => {
      reset()
      decide = () => ({ type: 'tool', tool: 'update_case', args: { caseId: 'case-1', title: '新标题' } })
      const done = doneOf(await run())
      assert.equal(writes, 1); assert.equal(done.actions.length, 1)
      assert.match(done.message, /连续重复相同操作/)
      assert.match(done.message, /已保存用例修改 1/)
      assert.doesNotMatch(done.message, /请继续说明|已全部完成/)
      assert(modelCalls < MAX_AGENT_STEPS)
      assert(requestLog.at(-1)!.messages.some(m => m.role === 'system' && m.content.includes('只能返回')))
    })
    await t.test('连续失败会返回具体原因，不耗尽整轮后再让用户重述目标', async () => {
      reset()
      toolRegistry.read_requirement.execute = async (): Promise<ToolResult> => { reads++; throw new Error('该条款不存在，请核对编号') }
      decide = call => ({ type: 'tool', tool: 'read_requirement', args: { keyword: String(call) } })
      const done = doneOf(await run())
      assert.equal(reads, 3); assert.equal(done.actions.length, 3)
      assert(done.actions.every(action => action.error))
      assert.match(done.message, /该条款不存在/)
      assert.match(done.message, /没有工具操作执行成功/)
    })
    await t.test('长任务仍有执行保护，汇总只能返回最终说明并保留全部工具记录', async () => {
      reset()
      decide = (call, summary) => summary
        ? { type: 'final', message: '已读取本轮条款，剩余条款尚未处理。' }
        : { type: 'tool', tool: 'read_requirement', args: { keyword: String(call) } }
      const done = doneOf(await run())
      assert.equal(reads, MAX_AGENT_STEPS); assert.equal(done.actions.length, MAX_AGENT_STEPS)
      assert.match(done.message, /尚未确认原目标全部完成/)
      assert.match(done.message, /剩余条款尚未处理/)
      assert.equal(modelCalls, MAX_AGENT_STEPS + 1)
    })
    await t.test('等待模型期间停止，返回的工具指令不会继续执行', async () => {
      reset()
      decide = () => ({ type: 'tool', tool: 'update_case', args: { caseId: 'case-1', title: '不应写入' } })
      onModelResponse = () => { disconnected = true }
      const events = await run()
      assert.equal(writes, 0); assert.equal(events.filter(event => event.type === 'action').length, 0)
      assert(!events.some(event => event.type === 'done'))
    })
  } finally {
    globalThis.fetch = originalFetch
    toolRegistry.read_requirement.execute = originalRead
    toolRegistry.update_case.execute = originalUpdate
    Object.assign(config, previous)
  }
})
