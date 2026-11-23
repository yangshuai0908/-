import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeTab, agentPendingRequest, agentWorkspaceContext, applyAgentAction, canvasFocus, casesRevision, currentProjectId, currentRequirementId, highlightedCaseId, openAgentArtifact, requirements, selectedCompareId, setCanvasFocus } from './workspace'

test('workspace refresh and navigation are driven by result references, isolated by project/version', () => {
  currentProjectId.value = 'project-one'; currentRequirementId.value = 'version-one'; activeTab.value = 'points'
  requirements.value = [{ id: 'version-one' }, { id: 'version-two' }] as typeof requirements.value
  setCanvasFocus({ type: 'point', id: 'point-one', title: '页面标题', meta: { untrusted: '不传快照' } })
  assert.deepEqual(agentWorkspaceContext(), { page: 'points', focus: { type: 'point', id: 'point-one' } })
  const result = { tool: 'update_case', title: '已保存', projectId: 'project-one', requirementId: 'version-one', changes: ['cases' as const], artifact: { view: 'cases' as const, requirementId: 'version-one', caseId: 'case-one' } }
  const revision = casesRevision.value
  applyAgentAction({ ...result, projectId: 'other' }); applyAgentAction({ ...result, error: '保存失败' })
  assert.equal(casesRevision.value, revision)
  applyAgentAction(result); openAgentArtifact(result)
  assert.equal(casesRevision.value, revision + 1); assert.equal(activeTab.value, 'cases'); assert.equal(highlightedCaseId.value, 'case-one'); assert.equal(canvasFocus.value, null)
  openAgentArtifact({ ...result, artifact: { view: 'compare', requirementId: 'version-two', reportId: 'compare-one' } })
  assert.equal(currentRequirementId.value, 'version-two'); assert.equal(selectedCompareId.value, 'compare-one')
  agentPendingRequest.value = { prompt: '旧项目指令' }; currentProjectId.value = 'project-two'
  assert.equal(agentPendingRequest.value, null); assert.equal(selectedCompareId.value, null)
})
