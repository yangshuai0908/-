export type Category = 'normal' | 'abnormal' | 'boundary' | 'permission'
export type Priority = 'P0' | 'P1' | 'P2'
export type SourceType = 'paste' | 'md' | 'txt' | 'docx'
export type EvidenceState = 'explicit' | 'inferred' | 'unknown'
export type Verdict = 'unreviewed' | 'effective' | 'needs_revision' | 'invalid'
export type RevisionCost = 'none' | 'low' | 'medium' | 'high'
export type GapStatus = 'unconfirmed' | 'confirmed_ok' | 'missing'

export interface Project {
  id: string
  name: string
  createdAt: string
}

export interface Chunk {
  reqId: string
  sectionPath: string
  text: string
  order: number
}

export interface AnalysisEvidence {
  reqId: string
  quote: string
  matched: boolean
}

export interface TestPoint {
  id: string
  title: string
  category: Category
  objective: string
  evidence: AnalysisEvidence[]
  questions: string[]
  status: 'pending' | 'confirmed' | 'excluded'
}

export interface RequirementAnalysisSection {
  reqId: string
  points: TestPoint[]
  questions: string[]
  notTestableReason: string
}

export interface RequirementAnalysis {
  id: string
  createdAt: string
  updatedAt: string
  sections: RequirementAnalysisSection[]
}

export interface RequirementVersion {
  id: string
  projectId: string
  label: string
  rawText: string
  sourceType: SourceType
  chunks: Chunk[]
  /** 从正文里抽出来的接口清单（GET /api/xxx 这类行），生成用例时会一并喂给模型 */
  apiList?: string[]
  analysis?: RequirementAnalysis
  createdAt: string
}

export interface Evidence {
  reqId: string
  quote: string
  state: EvidenceState
  quoteMatch?: 'exact' | 'fuzzy' | 'missing'
  conditionSupport?: EvidenceState
  expectedSupport?: EvidenceState
  sectionPath?: string
  score: number
  reason: string
  relocated?: string
}

/** 测试/业务人员的人工评审结论，挂在用例上，随导出一起带走 */
export interface Assessment {
  verdict: Verdict
  reviewer: string
  comment: string
  revisionCost: RevisionCost
  reviewedAt: string | null
}

export interface GapReview {
  id: string
  requirementId: string
  reqId: string
  status: GapStatus
  reviewer: string
  comment: string
  updatedAt: string
}

export interface AssessmentSummary {
  total: number
  reviewed: number
  pending: number
  reviewRate: number
  byVerdict: Record<Verdict, number>
  byCost: Record<RevisionCost, number>
  byReviewer: { reviewer: string; count: number }[]
  effectiveRate: number
  revisionEffortPoints: number
  highCostCount: number
  pendingCases: { id: string; title: string }[]
  actionCases: { id: string; title: string; verdict: Verdict; revisionCost: RevisionCost }[]
  gap: { testable: number; confirmedOk: number; missing: number; unconfirmed: number }
  testableChunks: { reqId: string; sectionPath: string }[]
}

/** 旧数据里没有 assessment，统一按「待评审」渲染 */
export function blankAssessment(): Assessment {
  return { verdict: 'unreviewed', reviewer: '', comment: '', revisionCost: 'none', reviewedAt: null }
}

export function assessmentOf(c: { assessment?: Assessment }): Assessment {
  return { ...blankAssessment(), ...(c.assessment ?? {}) }
}

export interface TestCase {
  id: string
  projectId: string
  requirementId: string
  title: string
  category: Category
  priority: Priority
  module: string
  precondition: string
  steps: string[]
  expected: string[]
  evidence: Evidence[]
  assumptions: string[]
  businessConfirmation?: string
  businessConfirmer?: string
  assessment?: Assessment
  origin: 'generated' | 'manual'
  source?: {
    runId: string
    analysisId: string
    analysisUpdatedAt: string
    pointId: string
    title: string
    objective: string
    reqIds: string[]
  }
  updatedAt: string
}

export interface WorkflowTrace {
  id: string
  requirementId: string
  projectId: string
  kind: 'analysis' | 'generation' | 'point_edit' | 'case_edit' | 'assessment' | 'recheck'
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt?: string
  model: string
  input?: unknown
  output?: unknown
  error?: string
  caseIds: string[]
  steps?: {
    id: string
    name: string
    status: 'running' | 'succeeded' | 'failed'
    startedAt: string
    finishedAt?: string
    input: unknown
    output?: unknown
    error?: string
  }[]
}

export interface ChangeItem {
  type: 'added' | 'removed' | 'modified' | 'unchanged'
  sectionPath: string
  fromReqId?: string
  toReqId?: string
  before?: string
  after?: string
  score: number
}

export interface CompareReport {
  id: string
  projectId: string
  fromReqId: string
  toReqId: string
  changes: ChangeItem[]
  impactedCaseIds: string[]
  results: {
    newCases: {
      title: string
      category?: Category
      priority?: Priority
      module?: string
      precondition?: string
      steps?: string[]
      expected?: string[]
      evidence?: { reqId: string; quote: string }[]
      assumptions?: string[]
    }[]
    adjustedCases: {
      caseId: string
      caseTitle: string
      reason: string
      change: string
      patch?: { title?: string; precondition?: string; steps?: string[]; expected?: string[] }
    }[]
    deprecatedCases: { caseId: string; caseTitle: string; reason: string }[]
    notes: string[]
  }
  createdAt: string
}

export interface ReviewReport {
  id: string
  requirementId: string
  coverage: { reqId: string; sectionPath: string; caseIds: string[]; testable?: boolean }[]
  coverageRate: number
  duplicates: { caseIds: string[]; title: string; reason: string }[]
  gaps: { reqId: string; sectionPath: string; reason: string; severity: 'high' | 'medium' | 'low' }[]
  scores: {
    coverage: number
    completeness: number
    executability: number
    verifiability: number
    total: number
  }
  advice: string[]
  categoryStats: Record<string, number>
  createdAt: string
}

export interface HealthInfo {
  ok: boolean
  llm: { ready: boolean; reason: string }
  model: string
  envFile: string | null
}

export const CATEGORY_LABEL: Record<Category, string> = {
  normal: '正常',
  abnormal: '异常',
  boundary: '边界',
  permission: '权限',
}

export const CATEGORY_COLOR: Record<Category, string> = {
  normal: '#4d8b6c',
  abnormal: '#b85858',
  boundary: '#a7792f',
  permission: '#766494',
}

export const STATE_LABEL: Record<EvidenceState, string> = {
  explicit: '明确支持',
  inferred: '推导待确认',
  unknown: '依据不足',
}

export const STATE_COLOR: Record<EvidenceState, string> = {
  explicit: '#4d8b6c',
  inferred: '#a7792f',
  unknown: '#b85858',
}

export function evidenceStateOf(evidence: Evidence[]): EvidenceState {
  if (!evidence.length) return 'unknown'
  if (evidence.some((e) => e.quoteMatch === 'missing' || !['explicit', 'inferred', 'unknown'].includes(e.state))) return 'unknown'
  const condition = evidence.some((e) => e.conditionSupport === 'explicit') ? 'explicit'
    : evidence.some((e) => e.conditionSupport === 'inferred') ? 'inferred' : 'unknown'
  const expected = evidence.some((e) => e.expectedSupport === 'explicit') ? 'explicit'
    : evidence.some((e) => e.expectedSupport === 'inferred') ? 'inferred' : 'unknown'
  if (condition === 'unknown' || expected === 'unknown') return 'unknown'
  return condition === 'explicit' && expected === 'explicit' && evidence.every((e) => e.quoteMatch === 'exact')
    ? 'explicit' : 'inferred'
}

export function evidenceNeedsRecheck(evidence: Evidence[]): boolean {
  return evidence.some((e) => !['explicit', 'inferred', 'unknown'].includes(e.state) || e.quoteMatch === undefined)
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  unreviewed: '待评审',
  effective: '有效',
  needs_revision: '需修改',
  invalid: '建议废弃',
}

export const VERDICT_COLOR: Record<Verdict, string> = {
  unreviewed: '#8c96a3',
  effective: '#4d8b6c',
  needs_revision: '#a7792f',
  invalid: '#b85858',
}

export const COST_LABEL: Record<RevisionCost, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
}

export const COST_COLOR: Record<RevisionCost, string> = {
  none: '#8c96a3',
  low: '#4d8b6c',
  medium: '#a7792f',
  high: '#b85858',
}

/** 相对工作量刻度，和后端 assessment.ts 保持一致；不是工时 */
export const COST_POINTS: Record<RevisionCost, number> = { none: 0, low: 1, medium: 3, high: 6 }

export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  unconfirmed: '未确认',
  confirmed_ok: '已确认无遗漏',
  missing: '存在遗漏',
}
