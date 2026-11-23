import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import express from 'express'
import { config } from '../config.js'
import { requirementsRouter } from '../modules/requirements/routes.js'
import { clearCache } from '../llm/cache.js'
import { AppError } from '../utils.js'
import type { Chunk, RequirementAnalysis, RequirementVersion } from '../store/schema.js'

const quantityText = '查询数量必须 <= 20，超过上限时拒绝查询。该限制适用于单次请求，分页查询同样受此约束，导出功能与批量导入不受此限制，统计报表功能另行约定。'
const document = `# 查询需求\n\n## 数量\n${quantityText}\n\n## 权限\n普通用户只能查询本人记录。`
const sectionOf = (chunk: Chunk) => ({
  reqId: chunk.reqId,
  points: [{
    title: `${chunk.sectionPath}规则`, category: 'normal', objective: '验证原文规定的行为和适用条件',
    evidence: [{ reqId: chunk.reqId, quote: chunk.text }], questions: [],
  }],
  questions: [], notTestableReason: '',
})

async function startHarness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testpilot-incremental-'))
  const originalConfig = { ...config }
  Object.assign(config, { dataDir: directory, apiKey: 'local-fixture-only', baseUrl: 'http://127.0.0.1:1', model: 'local-incremental-fixture', llmCache: true, inheritAnalysis: true })
  clearCache()
  const originalFetch = globalThis.fetch
  let modelCalls = 0
  let modelOutput: ((chunks: Chunk[]) => string) | undefined
  globalThis.fetch = async (_input, init) => {
    modelCalls++
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }
    const payload = JSON.parse(body.messages.find((message) => message.role === 'user')!.content)
    const content = modelOutput?.(payload.chunks) ?? JSON.stringify({ sections: payload.chunks.map(sectionOf) })
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
  }
  const app = express()
  app.use(express.json())
  app.use('/api', requirementsRouter)
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof AppError ? error.status : 500).json({ error: error.message })
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api`
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const response = await originalFetch(url + route, {
      method, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() as any }
  }
  return {
    request, directory,
    calls: () => modelCalls,
    setOutput: (value?: (chunks: Chunk[]) => string) => { modelOutput = value },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      globalThis.fetch = originalFetch
      Object.assign(config, originalConfig)
      clearCache()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('内容缓存、增量重分析与跨版本继承', async (t) => {
  const harness = await startHarness()
  const { request } = harness
  t.after(harness.close)
  const project = await request('/projects', 'POST', { name: '增量隔离测试' })
  const upload = (label: string, rawText: string) => request(`/projects/${project.data.id}/requirements`, 'POST', { label, rawText })
  const confirm = async (requirementId: string, analysis: RequirementAnalysis, sectionIndex = 0) => {
    const point = analysis.sections[sectionIndex].points[0]
    const response = await request(`/requirements/${requirementId}/analysis/points/${point.id}`, 'PATCH', {
      analysisId: analysis.id, analysisUpdatedAt: analysis.updatedAt,
      title: point.title, category: point.category, objective: point.objective,
      evidence: point.evidence.map(({ reqId, quote }) => ({ reqId, quote })),
      questions: [], status: 'confirmed', reviewer: '隔离核对人',
    })
    assert.equal(response.status, 200)
    return response.data as RequirementAnalysis
  }

  const v1 = (await upload('v1', document)).data as RequirementVersion
  assert.equal(v1.chunks.length, 2)
  assert.equal(v1.analysis, undefined)
  const route = `/requirements/${v1.id}/analysis`
  const first = await request(route, 'POST', {})
  assert.equal(first.status, 200)
  assert.equal(harness.calls(), 1)
  let analysis: RequirementAnalysis = first.data
  const originalPointId = analysis.sections[0].points[0].id
  analysis = await confirm(v1.id, analysis)

  await t.test('条款未变化时重分析不调模型，原分析与人工确认原样保留', async () => {
    const calls = harness.calls()
    const response = await request(route, 'POST', { replaceAnalysisId: analysis.id })
    assert.equal(response.status, 200)
    assert.equal(response.data.id, analysis.id)
    assert.equal(harness.calls(), calls)
    assert.equal(response.data.sections[0].points[0].status, 'confirmed')
    assert.equal(response.data.sections[0].points[0].id, originalPointId)
  })

  await t.test('强制重分析结果一致时，按输出指纹保留人工确认（分析 id 更新）', async () => {
    const calls = harness.calls()
    const response = await request(route, 'POST', { replaceAnalysisId: analysis.id, force: true })
    assert.equal(response.status, 200)
    assert.equal(harness.calls() - calls, 1)
    assert.notEqual(response.data.id, analysis.id)
    const point = response.data.sections[0].points[0]
    assert.equal(point.id, originalPointId)
    assert.equal(point.status, 'confirmed')
    assert.equal(point.review.reviewer, '隔离核对人')
    analysis = response.data
  })

  let confirmedPointId = originalPointId
  await t.test('强制重分析结果变化时，变化的测试点重置为待确认', async () => {
    harness.setOutput((chunks) => JSON.stringify({
      sections: chunks.map((chunk) => ({ ...sectionOf(chunk), points: [{ ...sectionOf(chunk).points[0], objective: '验证另一个不同的目标' }] })),
    }))
    const response = await request(route, 'POST', { replaceAnalysisId: analysis.id, force: true })
    assert.equal(response.status, 200)
    const point = response.data.sections[0].points[0]
    assert.equal(point.status, 'pending')
    assert.notEqual(point.id, originalPointId)
    harness.setOutput()
    analysis = await confirm(v1.id, response.data)
    confirmedPointId = analysis.sections[0].points[0].id
  })

  await t.test('上传新版本继承未变条款的确认结果，只分析变化条款', async () => {
    const changed = document.replace('普通用户只能查询本人记录。', '普通用户只能查询本人记录，管理员可查询全部记录。')
    const created = await upload('v3 修改权限', changed)
    const v3 = created.data as RequirementVersion & { inheritance: { sections: number; confirmed: number; totalChunks: number } }
    assert.equal(v3.inheritance.sections, 1)
    assert.equal(v3.inheritance.confirmed, 1)
    assert.equal(v3.inheritance.totalChunks, 2)
    assert.equal(v3.analysis!.sections.length, 1)
    assert.equal(v3.analysis!.sections[0].points[0].status, 'confirmed')
    assert.equal(v3.analysis!.sections[0].points[0].id, confirmedPointId)
    const calls = harness.calls()
    const response = await request(`/requirements/${v3.id}/analysis`, 'POST', {})
    assert.equal(response.status, 200)
    assert.equal(harness.calls() - calls, 1)
    assert.equal(response.data.sections.length, v3.chunks.length)
    const inherited = response.data.sections.find((section: { reqId: string }) => section.reqId === v3.analysis!.sections[0].reqId)
    assert.equal(inherited.points[0].status, 'confirmed')
    assert.equal(inherited.points[0].id, confirmedPointId)
  })

  await t.test('继承后引用不再逐字匹配时降级为待确认，确认不能悄悄跨版本生效', async () => {
    const tweaked = document.replace('超过上限时拒绝查询。', '超过上限时拒绝本次查询。')
    const v4 = (await upload('v4 微调数量', tweaked)).data as RequirementVersion & { inheritance: { sections: number; confirmed: number } }
    assert.equal(v4.inheritance.sections, 1)
    assert.equal(v4.inheritance.confirmed, 0)
    const quantity = v4.analysis!.sections[0]
    assert.equal(quantity.points[0].status, 'pending')
    assert.equal(quantity.points[0].evidence[0].matched, false)
    const calls = harness.calls()
    const response = await request(`/requirements/${v4.id}/analysis`, 'POST', {})
    assert.equal(response.status, 200)
    assert.equal(harness.calls() - calls, 1)
    assert.equal(response.data.sections.length, 2)
    assert.equal(response.data.sections[0].points[0].status, 'pending')
  })

  await t.test('相同输入命中内容缓存，不再发起模型请求', async () => {
    Object.assign(config, { inheritAnalysis: false })
    const v5 = (await upload('v5 缓存验证', document)).data as RequirementVersion
    assert.equal(v5.analysis, undefined)
    const calls = harness.calls()
    const response = await request(`/requirements/${v5.id}/analysis`, 'POST', {})
    assert.equal(response.status, 200)
    assert.equal(harness.calls(), calls)
    assert.equal(response.data.sections.length, v5.chunks.length)
    assert(fs.existsSync(path.join(harness.directory, 'llm-cache.json')))
    Object.assign(config, { inheritAnalysis: true })
  })
})