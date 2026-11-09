import { Router } from 'express'
import ExcelJS from 'exceljs'
import { assessmentOf, COST_LABEL, VERDICT_LABEL } from '../review/assessment.js'
import * as repo from '../store/fsRepo.js'
import type { RequirementVersion, TestCase } from '../store/schema.js'
import { AppError } from '../utils.js'
import { overallState } from '../validate/evidence.js'

export const exportRouter = Router()

const CATEGORY_CN: Record<string, string> = {
  normal: '正常',
  abnormal: '异常',
  boundary: '边界',
  permission: '权限',
}

const STATE_CN: Record<string, string> = {
  explicit: '明确支持',
  inferred: '推导待确认',
  unknown: '依据不足',
}

/** 导出的列顺序固定，方便测试同学回填自有模板 */
const COLUMNS: { header: string; key: string; width: number }[] = [
  { header: '用例编号', key: 'no', width: 12 },
  { header: '分类', key: 'category', width: 8 },
  { header: '优先级', key: 'priority', width: 8 },
  { header: '所属模块', key: 'module', width: 18 },
  { header: '用例标题', key: 'title', width: 42 },
  { header: '前置条件', key: 'precondition', width: 30 },
  { header: '测试步骤', key: 'steps', width: 52 },
  { header: '预期结果', key: 'expected', width: 52 },
  { header: '需求依据（条款）', key: 'evidence', width: 40 },
  { header: '依据原文', key: 'quote', width: 44 },
  { header: '依据状态', key: 'state', width: 12 },
  { header: '假设与待确认', key: 'assumptions', width: 32 },
  // 人工评审列追加在末尾，前面原有列顺序不变，已回填过的模板不会错位
  { header: '人工评审结论', key: 'verdict', width: 14 },
  { header: '评审人', key: 'reviewer', width: 12 },
  { header: '修改成本', key: 'revisionCost', width: 10 },
  { header: '评审批注 / 遗漏说明', key: 'comment', width: 36 },
  { header: '业务确认结果（人工）', key: 'businessConfirmation', width: 40 },
  { header: '业务确认人', key: 'businessConfirmer', width: 16 },
  { header: '系统用例 ID', key: 'caseId', width: 24 },
  { header: '来源测试点 ID', key: 'pointId', width: 24 },
  { header: '来源测试点', key: 'pointTitle', width: 36 },
  { header: '生成追溯 ID', key: 'runId', width: 24 },
]

function toRow(c: TestCase, index: number): Record<string, string> {
  const evidence = c.evidence.length ? c.evidence : []
  const a = assessmentOf(c)
  return {
    no: `TC-${String(index + 1).padStart(3, '0')}`,
    category: CATEGORY_CN[c.category] ?? c.category,
    priority: c.priority,
    module: c.module ?? '',
    title: c.title,
    precondition: c.precondition ?? '',
    steps: c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    expected: c.expected.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    evidence: evidence.map((e) => `${e.reqId}`).join('\n'),
    quote: evidence.map((e) => e.quote).join('\n---\n'),
    state: evidence.map((e) => STATE_CN[e.state] ?? '待重新校验').join('\n'),
    assumptions: (c.assumptions ?? []).join('\n'),
    verdict: VERDICT_LABEL[a.verdict] ?? '待评审',
    reviewer: a.reviewer || '',
    revisionCost: a.verdict === 'needs_revision' ? (COST_LABEL[a.revisionCost] ?? '') : '',
    comment: a.comment || '',
    businessConfirmation: c.businessConfirmation ?? '',
    businessConfirmer: c.businessConfirmer ?? '',
    caseId: c.id,
    pointId: c.source?.pointId ?? '',
    pointTitle: c.source?.title ?? '',
    runId: c.source?.runId ?? '',
  }
}

function escapeCsv(value: string): string {
  const s = value ?? ''
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

exportRouter.get('/requirements/:rid/export', async (req, res) => {
  const rid = String(req.params.rid)
  const requirement = repo.findById<RequirementVersion>('requirements', rid)
  if (!requirement) throw new AppError('需求版本不存在', 404)

  const format = String(req.query.format ?? 'xlsx').toLowerCase()
  const cases = repo
    .all<TestCase>('cases')
    .filter((c) => c.requirementId === rid)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))

  if (!cases.length) throw new AppError('该需求版本下还没有用例，先跑一次生成')

  const baseName = `${requirement.label}-测试用例`

  if (format === 'csv') {
    const lines = [COLUMNS.map((c) => c.header).join(',')]
    cases.forEach((c, i) => {
      const row = toRow(c, i)
      lines.push(COLUMNS.map((col) => escapeCsv(row[col.key] ?? '')).join(','))
    })
    // BOM 让 Excel 正确识别 UTF-8，否则中文乱码
    const csv = '\uFEFF' + lines.join('\r\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.csv`)
    res.send(csv)
    return
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'TestPilot'
  const sheet = workbook.addWorksheet('测试用例')
  sheet.columns = COLUMNS

  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.height = 22

  cases.forEach((c, i) => {
    const row = sheet.addRow(toRow(c, i))
    row.alignment = { vertical: 'top', wrapText: true }
    // 依据状态列用底色标出风险
    const stateCell = row.getCell('state')
    if (overallState(c.evidence) === 'unknown') {
      stateCell.font = { color: { argb: 'FFC00000' }, bold: true }
    } else if (overallState(c.evidence) === 'inferred') {
      stateCell.font = { color: { argb: 'FFB8860B' } }
    }
    // 人工评审结论也标色：需修改 / 建议废弃的一眼能挑出来
    const verdictCell = row.getCell('verdict')
    const verdict = assessmentOf(c).verdict
    if (verdict === 'needs_revision') {
      verdictCell.font = { color: { argb: 'FFB8860B' }, bold: true }
    } else if (verdict === 'invalid') {
      verdictCell.font = { color: { argb: 'FFC00000' }, bold: true }
    }
  })

  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.xlsx`)
  await workbook.xlsx.write(res)
  res.end()
})
