import { z } from 'zod'

export const ChunkSchema = z.object({
  reqId: z.string(),
  sectionPath: z.string(),
  text: z.string(),
  order: z.number(),
})
export type Chunk = z.infer<typeof ChunkSchema>

export const SourceTypeSchema = z.enum(['paste', 'md', 'txt', 'docx'])
export type SourceType = z.infer<typeof SourceTypeSchema>

export const AnalysisEvidenceSchema = z.object({
  reqId: z.string().trim().min(1).max(100),
  quote: z.string().trim().min(1).max(1800),
  matched: z.boolean(),
})

export const TestPointSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(200),
  category: z.enum(['normal', 'abnormal', 'boundary', 'permission']),
  objective: z.string().trim().min(1).max(1000),
  evidence: z.array(AnalysisEvidenceSchema).min(1).max(8),
  questions: z.array(z.string().trim().min(1).max(500)).max(20),
  status: z.enum(['pending', 'confirmed', 'excluded']),
})
export type TestPoint = z.infer<typeof TestPointSchema>

export const RequirementAnalysisSectionSchema = z.object({
  reqId: z.string().trim().min(1).max(100),
  points: z.array(TestPointSchema).max(60),
  questions: z.array(z.string().trim().min(1).max(500)).max(30),
  notTestableReason: z.string().trim().max(1000),
})
export const RequirementAnalysisSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sections: z.array(RequirementAnalysisSectionSchema),
})
export type RequirementAnalysis = z.infer<typeof RequirementAnalysisSchema>

export const RequirementSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  rawText: z.string(),
  sourceType: SourceTypeSchema,
  /** 从正文里提取到的 HTTP 接口定义，生成时作为附加输入 */
  apiList: z.array(z.string()).default([]),
  chunks: z.array(ChunkSchema),
  analysis: RequirementAnalysisSchema.optional(),
  createdAt: z.string(),
})
export type RequirementVersion = z.infer<typeof RequirementSchema>

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
})
export type Project = z.infer<typeof ProjectSchema>

export const EvidenceStateSchema = z.enum(['explicit', 'inferred', 'unknown'])

export const EvidenceSchema = z.object({
  reqId: z.string(),
  quote: z.string(),
  state: EvidenceStateSchema.default('unknown'),
  quoteMatch: z.enum(['exact', 'fuzzy', 'missing']).default('missing'),
  conditionSupport: EvidenceStateSchema.default('unknown'),
  expectedSupport: EvidenceStateSchema.default('unknown'),
  sectionPath: z.string().optional(),
  score: z.number().default(0),
  reason: z.string().default(''),
  /** 自动重定位后命中的原文真句（存在则 UI 展示建议替换） */
  relocated: z.string().optional(),
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const CategorySchema = z.enum(['normal', 'abnormal', 'boundary', 'permission'])
export const PrioritySchema = z.enum(['P0', 'P1', 'P2'])

/** 人工评审结论。unreviewed 表示尚未由测试/业务人员过目 */
export const VerdictSchema = z.enum(['unreviewed', 'effective', 'needs_revision', 'invalid'])
export type Verdict = z.infer<typeof VerdictSchema>

/** 修改成本刻度：不是工时估算，只是用于横向比较的相对量 */
export const RevisionCostSchema = z.enum(['none', 'low', 'medium', 'high'])
export type RevisionCost = z.infer<typeof RevisionCostSchema>

export const AssessmentSchema = z.object({
  verdict: VerdictSchema.default('unreviewed'),
  reviewer: z.string().default(''),
  comment: z.string().default(''),
  revisionCost: RevisionCostSchema.default('none'),
  reviewedAt: z.string().nullable().default(null),
})
export type Assessment = z.infer<typeof AssessmentSchema>

/** 旧数据没有 assessment 字段，读取时一律用它兜底 */
export function blankAssessment(): Assessment {
  return { verdict: 'unreviewed', reviewer: '', comment: '', revisionCost: 'none', reviewedAt: null }
}

/** 条款级遗漏的人工确认（与用例级评审分开存） */
export const GapStatusSchema = z.enum(['unconfirmed', 'confirmed_ok', 'missing'])
export type GapStatus = z.infer<typeof GapStatusSchema>

export const GapReviewSchema = z.object({
  id: z.string(),
  requirementId: z.string(),
  reqId: z.string(),
  status: GapStatusSchema.default('unconfirmed'),
  reviewer: z.string().default(''),
  comment: z.string().default(''),
  updatedAt: z.string(),
})
export type GapReview = z.infer<typeof GapReviewSchema>

export const TestCaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  requirementId: z.string(),
  title: z.string(),
  category: CategorySchema,
  priority: PrioritySchema.default('P1'),
  module: z.string().default(''),
  precondition: z.string().default(''),
  steps: z.array(z.string()).default([]),
  expected: z.array(z.string()).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  businessConfirmation: z.string().default(''),
  businessConfirmer: z.string().default(''),
  assessment: AssessmentSchema.default(blankAssessment),
  origin: z.enum(['generated', 'manual']).default('generated'),
  source: z.object({
    runId: z.string(),
    analysisId: z.string(),
    analysisUpdatedAt: z.string(),
    pointId: z.string(),
    title: z.string(),
    objective: z.string(),
    reqIds: z.array(z.string()),
  }).optional(),
  updatedAt: z.string(),
})
export type TestCase = z.infer<typeof TestCaseSchema>

/** LLM 原始输出（无 id 等本地字段），宽松校验后再补齐 */
export const LlmCaseSchema = z.object({
  testPointId: z.string().optional(),
  title: z.string(),
  category: CategorySchema.optional(),
  priority: PrioritySchema.optional(),
  module: z.string().optional(),
  precondition: z.string().optional(),
  steps: z.array(z.string()).optional(),
  expected: z.array(z.string()).optional(),
  evidence: z
    .array(z.object({ reqId: z.string(), quote: z.string() }))
    .optional(),
  assumptions: z.array(z.string()).optional(),
})

export const LlmGenerateResultSchema = z.object({
  cases: z.array(LlmCaseSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  uncovered: z.array(z.string()).default([]),
})
export type LlmGenerateResult = z.infer<typeof LlmGenerateResultSchema>

export const ChangeItemSchema = z.object({
  type: z.enum(['added', 'removed', 'modified', 'unchanged']),
  sectionPath: z.string(),
  fromReqId: z.string().optional(),
  toReqId: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  score: z.number().default(0),
})
export type ChangeItem = z.infer<typeof ChangeItemSchema>

export const LlmAdjustedCaseSchema = z.object({
  caseId: z.string(),
  caseTitle: z.string().optional(),
  reason: z.string().default(''),
  change: z.string().default(''),
  patch: z
    .object({
      title: z.string().optional(),
      precondition: z.string().optional(),
      steps: z.array(z.string()).optional(),
      expected: z.array(z.string()).optional(),
    })
    .optional(),
})

export const LlmDeprecatedCaseSchema = z.object({
  caseId: z.string(),
  caseTitle: z.string().optional(),
  reason: z.string().default(''),
})

export const LlmCompareResultSchema = z.object({
  newCases: z.array(LlmCaseSchema).default([]),
  adjustedCases: z.array(LlmAdjustedCaseSchema).default([]),
  deprecatedCases: z.array(LlmDeprecatedCaseSchema).default([]),
  notes: z.array(z.string()).default([]),
})
export type LlmCompareResult = z.infer<typeof LlmCompareResultSchema>

export const CompareReportSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  fromReqId: z.string(),
  toReqId: z.string(),
  changes: z.array(ChangeItemSchema),
  impactedCaseIds: z.array(z.string()),
  results: z.object({
    newCases: z.array(LlmCaseSchema).default([]),
    adjustedCases: z
      .array(
        z.object({
          caseId: z.string(),
          caseTitle: z.string(),
          reason: z.string(),
          change: z.string(),
          patch: z
            .object({
              title: z.string().optional(),
              precondition: z.string().optional(),
              steps: z.array(z.string()).optional(),
              expected: z.array(z.string()).optional(),
            })
            .optional(),
        }),
      )
      .default([]),
    deprecatedCases: z
      .array(z.object({ caseId: z.string(), caseTitle: z.string(), reason: z.string() }))
      .default([]),
    notes: z.array(z.string()).default([]),
  }),
  createdAt: z.string(),
})
export type CompareReport = z.infer<typeof CompareReportSchema>

export const LlmReviewResultSchema = z.object({
  duplicates: z
    .array(z.object({ caseIds: z.array(z.string()), reason: z.string().default('') }))
    .default([]),
  gaps: z
    .array(
      z.object({
        reqId: z.string(),
        reason: z.string().default(''),
        severity: z.enum(['high', 'medium', 'low']).default('medium'),
      }),
    )
    .default([]),
  scores: z
    .object({
      completeness: z.number().optional(),
      executability: z.number().optional(),
      verifiability: z.number().optional(),
    })
    .optional(),
  advice: z.array(z.string()).default([]),
})
export type LlmReviewResult = z.infer<typeof LlmReviewResultSchema>

export const ReviewReportSchema = z.object({
  id: z.string(),
  requirementId: z.string(),
  coverage: z.array(
    z.object({
      reqId: z.string(),
      sectionPath: z.string(),
      caseIds: z.array(z.string()),
      // 旧报告没有这个字段，缺省视为可测，保证历史数据仍能读出来
      testable: z.boolean().default(true),
    }),
  ),
  coverageRate: z.number(),
  duplicates: z.array(z.object({ caseIds: z.array(z.string()), title: z.string(), reason: z.string() })),
  gaps: z.array(z.object({ reqId: z.string(), sectionPath: z.string(), reason: z.string(), severity: z.enum(['high', 'medium', 'low']) })),
  scores: z.object({
    coverage: z.number(),
    completeness: z.number(),
    executability: z.number(),
    verifiability: z.number(),
    total: z.number(),
  }),
  advice: z.array(z.string()),
  categoryStats: z.record(z.string(), z.number()),
  createdAt: z.string(),
})
export type ReviewReport = z.infer<typeof ReviewReportSchema>
