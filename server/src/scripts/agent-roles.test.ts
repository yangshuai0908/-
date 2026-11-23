import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENT_ROLE_IDS, AGENT_ROLES } from '@testpilot/shared'
import { getSystemPrompt } from '../modules/agent/prompts.js'
import { runTool, toolRegistry } from '../modules/agent/tools/index.js'

test('角色名称固定，分析、设计、审查使用各自工具，检查不能越界修改', async () => {
  assert.deepEqual(AGENT_ROLE_IDS.map(id => AGENT_ROLES[id].label), ['流程助手', '需求分析师', '用例设计师', '质量审查员'])
  for (const id of AGENT_ROLE_IDS) assert(getSystemPrompt(id).includes(`本轮角色：${AGENT_ROLES[id].label}`))
  for (const role of ['analyst', 'reviewer'] as const) {
    for (const tool of ['generate_cases', 'update_case', 'add_case'] as const) {
      await assert.rejects(runTool(tool, {}, { projectId: 'role-fixture', role }), new RegExp(`${AGENT_ROLES[role].label}不负责`))
    }
  }
  for (const tool of ['analyze_requirement', 'scan_vulnerabilities', 'review_cases'] as const) {
    await assert.rejects(runTool(tool, {}, { projectId: 'role-fixture', role: 'qa_expert' }), /用例设计师不负责/)
  }
  const originalAnalysis = toolRegistry.analyze_requirement.execute
  const originalGeneration = toolRegistry.generate_cases.execute
  const originalReview = toolRegistry.review_cases.execute
  const calls: string[] = []
  toolRegistry.analyze_requirement.execute = async () => { calls.push('analysis'); return { title: '候选测试点', data: {}, changes: ['requirements'] } }
  toolRegistry.generate_cases.execute = async () => { calls.push('generation'); return { title: '用例草稿', data: {}, changes: ['cases'] } }
  toolRegistry.review_cases.execute = async () => { calls.push('review'); return { title: '质量报告', data: {}, changes: ['review'] } }
  try {
    await runTool('analyze_requirement', {}, { projectId: 'role-fixture', role: 'analyst' })
    await runTool('generate_cases', {}, { projectId: 'role-fixture', role: 'qa_expert' })
    await runTool('review_cases', {}, { projectId: 'role-fixture', role: 'reviewer' })
    assert.deepEqual(calls, ['analysis', 'generation', 'review'])
  } finally {
    toolRegistry.analyze_requirement.execute = originalAnalysis
    toolRegistry.generate_cases.execute = originalGeneration
    toolRegistry.review_cases.execute = originalReview
  }
})
