import { computed, ref, watch } from 'vue'
import type { Project, RequirementVersion, TestCase } from '../types'
import type { AgentAction, AgentWorkspaceContext, WorkspacePage } from '@testpilot/shared'
import { api, type AgentRole } from '../api/client'

/** 模块级 ref 单例：所有视图共享同一份工作区状态 */
export const activeTab = ref<WorkspacePage>('requirement')
export const highlightedCaseId = ref<string | null>(null)
export function highlightCase(id: string): void {
  highlightedCaseId.value = id
  setTimeout(() => {
    if (highlightedCaseId.value === id) {
      highlightedCaseId.value = null
    }
  }, 3500)
}

/** 画布当前聚焦的实体（测试点、用例或条款），用于与 Agent 实时上下文对齐 */
export interface CanvasFocus {
  type: 'point' | 'case' | 'chunk'
  id: string
  title: string
  subtitle?: string
  meta?: any
}

export const canvasFocus = ref<CanvasFocus | null>(null)

export function setCanvasFocus(focus: CanvasFocus | null): void {
  canvasFocus.value = focus
}

export function clearCanvasFocus(): void {
  canvasFocus.value = null
}

export interface AgentPromptRequest {
  prompt: string
  autoSend?: boolean
  source?: string
  contextCaseId?: string
  role?: AgentRole
  focus?: CanvasFocus
}

export const agentPendingRequest = ref<AgentPromptRequest | null>(null)

export function sendToAgent(request: AgentPromptRequest): void {
  if (request.focus) {
    canvasFocus.value = request.focus
  }
  agentPendingRequest.value = request
}

export const projects = ref<Project[]>([])
export const currentProjectId = ref<string | null>(null)

export const requirements = ref<RequirementVersion[]>([])
export const currentRequirementId = ref<string | null>(null)
export const selectedAgentResult = ref<AgentAction | null>(null)
export const selectedReviewId = ref<string | null>(null)
export const selectedCompareId = ref<string | null>(null)
export const reviewsRevision = ref(0)
export const comparesRevision = ref(0)

watch([currentProjectId, currentRequirementId], () => {
  clearCanvasFocus()
  cases.value = []
  selectedAgentResult.value = null
  selectedReviewId.value = null
  selectedCompareId.value = null
  agentPendingRequest.value = null
}, { flush: 'sync' })
watch(activeTab, clearCanvasFocus, { flush: 'sync' })

export function agentWorkspaceContext(): AgentWorkspaceContext {
  return {
    page: activeTab.value as AgentWorkspaceContext['page'],
    focus: canvasFocus.value ? { type: canvasFocus.value.type, id: canvasFocus.value.id } : null,
  }
}

/** A single result contract drives both view refresh and artifact navigation. */
export function applyAgentAction(action: AgentAction): void {
  if (action.error || action.projectId !== currentProjectId.value) return
  if (action.changes?.includes('compare')) comparesRevision.value++
  if (action.requirementId !== currentRequirementId.value) return
  if (action.changes?.includes('requirements')) bumpRequirements()
  if (action.changes?.includes('cases')) bumpCases()
  if (action.changes?.includes('review')) reviewsRevision.value++
}

export function openAgentArtifact(action: AgentAction): void {
  if (action.error || !action.artifact || action.projectId !== currentProjectId.value) return
  const artifact = action.artifact
  if (artifact.requirementId && !requirements.value.some(item => item.id === artifact.requirementId)) return
  if (artifact.requirementId) currentRequirementId.value = artifact.requirementId
  selectedAgentResult.value = action
  if (artifact.view === 'review') selectedReviewId.value = artifact.reportId || null
  if (artifact.view === 'compare') selectedCompareId.value = artifact.reportId || null
  activeTab.value = artifact.view
  if (artifact.caseId) highlightCase(artifact.caseId)
}

export function openRiskScan(requirementId: string, scanId: string): void {
  const requirement = requirements.value.find(r => r.id === requirementId && r.projectId === currentProjectId.value)
  const scan = requirement?.riskScans?.find(s => s.id === scanId)
  if (!requirement || !scan) return
  openAgentArtifact({
    tool: 'scan_vulnerabilities', title: '需求风险走查 · 核对与处理建议',
    projectId: requirement.projectId, requirementId,
    artifact: { view: 'insights', requirementId },
    data: { requirementId, ...scan },
  })
}

export const cases = ref<TestCase[]>([])

/**
 * 用例变更信号：n-tabs 的面板常驻，切页签不会重新 onMounted。
 * 用例页改动后 bump 一下，评审页的汇总才能跟着刷新。
 */
export const casesRevision = ref(0)
export function bumpCases(): void {
  casesRevision.value++
}

let casesFetchId = 0
export async function loadWorkspaceCases(requirementId?: string | null): Promise<void> {
  const reqId = requirementId ?? currentRequirementId.value
  const fetchId = ++casesFetchId
  if (!reqId) {
    cases.value = []
    return
  }
  try {
    const list = await api.listCases(reqId)
    if (fetchId === casesFetchId && currentRequirementId.value === reqId) {
      cases.value = list
    }
  } catch {
    // 忽略加载错误
  }
}

watch(currentRequirementId, (id) => {
  void loadWorkspaceCases(id)
})
watch(casesRevision, () => {
  void loadWorkspaceCases(currentRequirementId.value)
})

export const requirementsRevision = ref(0)
export function bumpRequirements(): void {
  requirementsRevision.value++
}

export const currentProject = computed(
  () => projects.value.find((p) => p.id === currentProjectId.value) ?? null,
)

export const currentRequirement = computed(
  () => requirements.value.find((r) => r.id === currentRequirementId.value) ?? null,
)

export const readyRequirement = computed(() => {
  const req = currentRequirement.value
  return req ? req.chunks.length > 0 : false
})
