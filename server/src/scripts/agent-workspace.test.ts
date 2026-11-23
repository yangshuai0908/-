import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import express from 'express'
import { config } from '../config.js'
import * as repo from '../store/fsRepo.js'
import { blankAssessment, type RequirementVersion, type TestCase } from '../store/schema.js'
import { AppError } from '../utils.js'
import { agentRouter } from '../modules/agent/routes.js'
import { DecisionSchema } from '../modules/agent/types.js'
import { runTool, toolRegistry } from '../modules/agent/tools/index.js'
import { readWorkspaceContext } from '../modules/agent/workspace.js'
import { buildCase } from '../modules/cases/buildCase.js'
import { requirementsRouter } from '../modules/requirements/routes.js'
import { casesRouter, generateRouter, exportRouter } from '../modules/cases/index.js'
import { reviewRouter, compareRouter, assessmentRouter } from '../modules/review/index.js'

test('Agent and page operations share business objects, mutation rules and artifact references', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testpilot-workspace-'))
  const previous = { ...config }, originalFetch = globalThis.fetch
  Object.assign(config, { dataDir: directory, apiKey: 'isolated-workspace-fixture', baseUrl: 'http://fixture.invalid', model: '工作区固定样本' })
  repo.resetAll(directory)
  const at = '2026-11-11T00:00:00.000Z'
  const quote = '查询数量最多20条，超过时拒绝查询。'
  const requirement: RequirementVersion = { id: 'workspace-req', projectId: 'workspace-project', label: '边界验证需求', rawText: quote,
    sourceType: 'paste', apiList: [], createdAt: at, chunks: [{ reqId: 'REQ-001', sectionPath: '查询数量', text: quote, order: 0 }],
    analysis: { id: 'analysis-workspace', createdAt: at, updatedAt: at, sections: [{ reqId: 'REQ-001', questions: [], notTestableReason: '', points: [{ id: 'point-current', title: '拒绝超量查询', objective: '查询21条时拒绝查询', category: 'boundary', status: 'pending', questions: [], evidence: [{ reqId: 'REQ-001', quote, matched: true }] }] }] } }
  repo.insert('projects', { id: requirement.projectId, name: 'Agent 共享成果验证', createdAt: at }); repo.insert('requirements', requirement)
  repo.insert('requirements', { ...structuredClone(requirement), id: 'foreign-req', projectId: 'other-project' })
  const existing = buildCase({ title: '超量查询被拒绝', steps: ['查询21条记录'], expected: ['拒绝查询'], evidence: [{ reqId: 'REQ-001', quote }] }, { projectId: requirement.projectId, requirementId: requirement.id, category: 'boundary', chunks: requirement.chunks })
  repo.insert('cases', existing)
  const ctx = { projectId: requirement.projectId, currentRequirementId: requirement.id, workspace: { page: 'cases' as const, focus: { type: 'case' as const, id: existing.id } } }
  const captured: { role: string; content: string }[][] = []
  let modelCalls = 0
  let pauseSemantic: Promise<void> | null = null
  let semanticStarted: (() => void) | null = null
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith('http://fixture.invalid/')) return originalFetch(input, init)
    modelCalls++
    const body = JSON.parse(String(init?.body))
    if (!body.stream) {
      if (pauseSemantic) { semanticStarted?.(); await pauseSemantic }
      return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ caseIndex: 0, evidenceIndex: 0, condition: 'explicit', expected: 'explicit', target: 'explicit', reason: '固定样本复核' }] }) }, finish_reason: 'stop' }] })
    }
    const messages = body.messages as { role: string; content: string }[]; captured.push(messages)
    const result = messages.some(message => message.content.startsWith('工具 update_case 执行结果'))
      ? { type: 'final', message: '已修改并保存选中用例，请在右侧核对具体步骤和预期。' }
      : { type: 'tool', tool: 'update_case', args: { caseId: existing.id, steps: ['提交查询数量为21的请求', '检查返回结果'], expected: ['拒绝查询'] } }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const app = express().use(express.json())
  app.use('/api', requirementsRouter)
  app.use('/api', generateRouter)
  app.use('/api', casesRouter)
  app.use('/api', exportRouter)
  app.use('/api', compareRouter)
  app.use('/api', reviewRouter)
  app.use('/api', agentRouter)
  app.use('/api', assessmentRouter)
  const server = await new Promise<import('http').Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const address = server.address() as { port: number }
  const request = (route: string, body: unknown, method = 'POST') => originalFetch(`http://127.0.0.1:${address.port}/api${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    await t.test('reset helper refuses directory drift before any write', () => {
      Object.assign(config, { dataDir: path.join(directory, 'unexpected') })
      try { assert.throws(() => repo.resetAll(directory), /拒绝重置/); assert(!fs.existsSync(config.dataDir)) }
      finally { Object.assign(config, { dataDir: directory }) }
    })
    await t.test('context reads actual selected case and no design-task tool remains', () => {
      const snapshot = readWorkspaceContext(ctx)!
      assert.equal((snapshot.focus as { data: TestCase }).data.id, existing.id)
      assert.equal(snapshot.analysis?.pendingPoints, 1)
      assert(!('advance_design_task' in toolRegistry))
      assert.throws(() => readWorkspaceContext({ ...ctx, currentRequirementId: 'foreign-req' }), /当前项目/)
      assert.throws(() => readWorkspaceContext({ ...ctx, workspace: { page: 'cases', focus: { type: 'case', id: 'not-found' } } }), /选中对象已失效/)
    })
    await t.test('manual and Agent edits both clear stale human assessment and keep trace', async () => {
      const reviewed = { ...blankAssessment(), verdict: 'effective' as const, reviewer: '隔离评审人', reviewedAt: at }
      repo.update<TestCase>('cases', existing.id, { assessment: reviewed })
      const manual = await request(`/cases/${existing.id}`, { steps: ['人工修改步骤'] }, 'PATCH')
      assert.equal(manual.status, 200); assert.equal((await manual.json() as TestCase).assessment.verdict, 'unreviewed')
      repo.update<TestCase>('cases', existing.id, { assessment: reviewed })
      const response = await request('/agent/chat', { projectId: ctx.projectId, requirementId: requirement.id,
        workspace: { ...ctx.workspace, focus: { ...ctx.workspace.focus, title: 'CLIENT-FAKE-TITLE', meta: 'CLIENT-FAKE-DATA' } }, messages: [{ role: 'user', content: '细化选中用例的步骤' }] })
      assert.equal(response.status, 200)
      const events = (await response.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
      const action = events.find(event => event.type === 'action').action
      assert.deepEqual(action.artifact, { view: 'cases', requirementId: requirement.id, caseId: existing.id }); assert.deepEqual(action.changes, ['cases'])
      const saved = repo.findById<TestCase>('cases', existing.id)!
      assert.equal(saved.assessment.verdict, 'unreviewed'); assert.equal(saved.steps.length, 2)
      const context = captured[0].find(message => message.content.startsWith('当前工作台上下文'))!.content
      assert(context.includes(existing.id) && context.includes('人工修改步骤')); assert(!context.includes('CLIENT-FAKE'))
      assert(repo.all<{ input: { actor?: string } }>('traces').some(trace => trace.input.actor === 'agent'))
      assert(events.some(event => event.type === 'done'))
    })
    await t.test('Agent cannot save placeholders, absent evidence, or edit another version', async () => {
      const count = repo.all('cases').length
      await assert.rejects(runTool('add_case', { title: '空用例' }, ctx), /必须提供/)
      await assert.rejects(runTool('add_case', { title: '伪引用', steps: ['查询'], expected: ['拒绝'], evidence: [{ reqId: 'REQ-001', quote: '不存在的原文' }] }, ctx), /必须匹配/)
      assert.equal(repo.all('cases').length, count)
      await assert.rejects(runTool('generate_cases', {}, ctx), /确认/)
      repo.insert('cases', { ...existing, id: 'other-case', requirementId: 'other-version' })
      await assert.rejects(runTool('update_case', { caseId: 'other-case', title: '越界修改' }, ctx), /不属于当前需求/)
      repo.remove<TestCase>('cases', 'other-case')
      const calls = modelCalls
      const response = await request('/agent/chat', { projectId: ctx.projectId, requirementId: requirement.id, workspace: { page: 'cases', focus: { type: 'case', id: 'other-case' } }, messages: [{ role: 'user', content: '修改' }] })
      assert.equal(response.status, 409); assert.equal(modelCalls, calls)
    })
    await t.test('Agent can save a complete case but cannot forge human clarification fields', async () => {
      const added = await runTool('add_case', { title: '有依据的超量查询', steps: ['查询21条记录'], expected: ['拒绝查询'], evidence: [{ reqId: 'REQ-001', quote }] }, ctx)
      assert.equal(added.artifact?.view, 'cases')
      const id = (added.data as { caseId: string }).caseId
      assert.equal(repo.findById<TestCase>('cases', id)?.evidence[0].quoteMatch, 'exact')
      await runTool('update_case', { caseId: id, businessConfirmation: '伪造业务结论', businessConfirmer: '伪造签名' }, ctx)
      assert.equal(repo.findById<TestCase>('cases', id)?.businessConfirmation, '')
      assert.equal(repo.findById<TestCase>('cases', id)?.businessConfirmer, '')
      repo.remove<TestCase>('cases', id)
    })
    await t.test('a delayed Agent edit cannot overwrite a newer page edit', async () => {
      const original = structuredClone(repo.findById<TestCase>('cases', existing.id)!)
      let release!: () => void
      pauseSemantic = new Promise<void>(resolve => { release = resolve })
      const started = new Promise<void>(resolve => { semanticStarted = resolve })
      const delayed = runTool('update_case', { caseId: existing.id, steps: ['过时的模型步骤'] }, ctx)
      const rejection = assert.rejects(delayed, /校验期间已被修改/)
      try {
        await started
        repo.update<TestCase>('cases', existing.id, { title: '页面已修改', updatedAt: new Date(Date.parse(original.updatedAt) + 1000).toISOString() })
        release(); await rejection
        assert.equal(repo.findById<TestCase>('cases', existing.id)?.title, '页面已修改')
      } finally { release(); pauseSemantic = null; semanticStarted = null; repo.update<TestCase>('cases', existing.id, original) }
    })
    await t.test('DecisionSchema normalizes tool aliases and LLM formatting variations', () => {
      // 1. Plural alias analyze_requirements -> analyze_requirement
      const res1 = DecisionSchema.parse({ type: 'tool', tool: 'analyze_requirements', args: { requirementId: 'REQ-001' } })
      assert.equal(res1.type, 'tool')
      if (res1.type === 'tool') {
        assert.equal(res1.tool, 'analyze_requirement')
        assert.equal(res1.args.requirementId, 'REQ-001')
      }

      // 2. Missing type but has tool and stringified args
      const res2 = DecisionSchema.parse({ tool: 'compare_version', args: '{"fromReqId":"v1","toReqId":"v2"}' })
      assert.equal(res2.type, 'tool')
      if (res2.type === 'tool') {
        assert.equal(res2.tool, 'compare_versions')
        assert.equal(res2.args.fromReqId, 'v1')
      }

      // 3. OpenAI function calling format { name, arguments }
      const res3 = DecisionSchema.parse({ name: 'read_requirements', arguments: { requirementId: 'REQ-002' } })
      assert.equal(res3.type, 'tool')
      if (res3.type === 'tool') {
        assert.equal(res3.tool, 'read_requirement')
      }

      // 4. Missing type with content/message -> final
      const res4 = DecisionSchema.parse({ content: '需求已分析完成。' })
      assert.equal(res4.type, 'final')
      if (res4.type === 'final') {
        assert.equal(res4.message, '需求已分析完成。')
      }
    })
    if (process.argv.includes('--preview')) {
      console.log(`隔离预览 http://127.0.0.1:${address.port}（固定模型样本，不使用项目数据）`)
      await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    globalThis.fetch = originalFetch
    // Remove only the immutable directory created by this test, before restoring config.
    assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(directory, { recursive: true, force: true })
    Object.assign(config, previous)
  }
})
