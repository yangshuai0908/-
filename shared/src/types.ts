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
  methods?: string[]
  rationale?: string
  /** 模型原始输出指纹；重分析结果一致时据此保留人工修改与确认状态 */
  sourceHash?: string
  review?: { actor: 'human' | 'agent'; reviewer: string; at: string; comment: string; clarification?: string }
}

export interface RequirementAnalysisSection {
  reqId: string
  points: TestPoint[]
  questions: string[]
  notTestableReason: string
  /** 条款内容指纹；与当前条款一致则重分析时直接复用本节 */
  inputHash?: string
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
  riskScans?: RiskScan[]
  createdAt: string
}

/** 上传新版本时从上一版本继承分析结果的统计（随上传响应返回，不落库） */
export interface AnalysisInheritance {
  fromId: string
  fromLabel: string
  sections: number
  points: number
  confirmed: number
  totalChunks: number
}

export interface RiskIssue {
  id: string
  reqId: string
  type: 'conflict' | 'undefined_edge' | 'concurrency_race' | 'security_leak' | 'other'
  findingKind: 'needs_clarification' | 'rule_conflict' | 'test_suggestion' | 'covered'
  severity: 'critical' | 'high' | 'medium' | 'low'
  location: string
  description: string
  riskImpact: string
  evidence: AnalysisEvidence[]
  question: string
  defensiveCase?: {
    title: string
    category: Category
    priority: Priority
    precondition: string
    steps: string[]
    expected: string[]
  }
  resolution?: {
    action: 'question' | 'point' | 'covered' | 'ignored'
    comment: string
    at: string
    pointId?: string
  }
}

export interface RiskScan {
  id: string
  createdAt: string
  summary: string
  targetReqId?: string
  includedReqIds: string[]
  totalChunks: number
  contextTruncated: boolean
  issues: RiskIssue[]
}

export interface RiskResolutionInput {
  action: 'question' | 'point' | 'covered' | 'ignored'
  comment?: string
  question?: string
  point?: {
    title: string
    objective: string
    category: Category
    evidence: Pick<AnalysisEvidence, 'reqId' | 'quote'>[]
  }
  evidence?: Pick<AnalysisEvidence, 'reqId' | 'quote'>[]
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
    scenarioId?: string
    scenarioKind?: string
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

export interface ScenarioCoverage {
  scenarioId: string
  kind: string
  label: string
  status: 'covered' | 'stale' | 'missing'
  caseIds: string[]
  reason?: string
}

export interface PointCoverage {
  pointId: string
  title: string
  category: Category
  scenarios: ScenarioCoverage[]
}

export interface CoverageReport {
  analysisId: string
  analysisUpdatedAt: string
  summary: {
    points: number
    scenarios: number
    covered: number
    stale: number
    missing: number
    pending: number
    excluded: number
  }
  points: PointCoverage[]
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
