export * from '@testpilot/shared'

import type { Category, EvidenceState, Evidence, Verdict, RevisionCost, GapStatus } from '@testpilot/shared'

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

export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  unconfirmed: '未确认',
  confirmed_ok: '已确认无遗漏',
  missing: '存在遗漏',
}
