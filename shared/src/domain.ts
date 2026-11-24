import type { TestPoint, Assessment, RevisionCost } from './types.js'

/** 判断测试点是否已由人工确认 */
export function isHumanConfirmed(point: TestPoint): boolean {
  return point.status === 'confirmed' && point.review?.actor === 'human' && Boolean(point.review.reviewer.trim())
}

/** 旧数据里没有 assessment，统一按「待评审」渲染 */
export function blankAssessment(): Assessment {
  return { verdict: 'unreviewed', reviewer: '', comment: '', revisionCost: 'none', reviewedAt: null }
}

/** 获取用例的人工评审记录，缺失时使用默认待评审 */
export function assessmentOf(c: { assessment?: Assessment | null }): Assessment {
  return { ...blankAssessment(), ...(c.assessment ?? {}) }
}

/** 全平台统一的相对工作量刻度，不是工时 */
export const COST_POINTS: Record<RevisionCost, number> = { none: 0, low: 1, medium: 3, high: 6 }
