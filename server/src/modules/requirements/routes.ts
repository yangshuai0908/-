import { Router } from 'express'
import { z } from 'zod'
import { analyzeRequirement, updateTestPoint } from './analysis.js'
import { tracesOf, type WorkflowTrace } from '../../trace.js'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../../config.js'
import { chunkRequirement, extractApis } from '../../docs/chunk.js'
import { normalizeText, parseUploadedFile } from '../../docs/parse.js'
import * as repo from '../../store/fsRepo.js'
import type {
  CompareReport,
  GapReview,
  Project,
  RequirementVersion,
  ReviewReport,
  SourceType,
  TestCase,
} from '../../store/schema.js'
import { AppError, genId, nowIso } from '../../utils.js'

/** 项目下的需求版本列表 */
function requirementsOf(projectId: string): RequirementVersion[] {
  return repo
    .all<RequirementVersion>('requirements')
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** 删除需求时同步清理关联数据，避免留下孤儿记录 */
function purgeRequirementData(requirementId: string): void {
  repo.removeWhere<WorkflowTrace>('traces', (run) => run.requirementId === requirementId)
  repo.removeWhere<TestCase>('cases', (c) => c.requirementId === requirementId)
  repo.removeWhere<ReviewReport>('reviews', (r) => r.requirementId === requirementId)
  repo.removeWhere<GapReview>('gapReviews', (r) => r.requirementId === requirementId)
  repo.removeWhere<CompareReport>(
    'compares',
    (r) => r.fromReqId === requirementId || r.toReqId === requirementId,
  )
}

export const requirementsRouter = Router()

requirementsRouter.get('/requirements/:id/traces', (req, res) => {
  const id = String(req.params.id)
  if (!repo.findById<RequirementVersion>('requirements', id)) throw new AppError('需求版本不存在', 404)
  const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : ''
  res.json(tracesOf(id).filter(run => !caseId || run.caseIds.includes(caseId)).map(({ input, output, steps, ...summary }) => ({
    ...summary, stepCount: steps.length,
  })))
})

requirementsRouter.get('/requirements/:id/traces/:runId', (req, res) => {
  const run = tracesOf(String(req.params.id)).find(run => run.id === String(req.params.runId))
  if (!run) throw new AppError('追溯记录不存在于当前需求版本', 404)
  res.json(run)
})

requirementsRouter.get('/projects', (_req, res) => {
  res.json(repo.all<Project>('projects'))
})

requirementsRouter.post('/projects', (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) throw new AppError('项目名称不能为空')
  const project: Project = { id: genId('prj'), name, createdAt: nowIso() }
  repo.insert('projects', project)
  res.json(project)
})

requirementsRouter.delete('/projects/:id', (req, res) => {
  const id = String(req.params.id)
  if (!repo.findById<Project>('projects', id)) throw new AppError('项目不存在', 404)
  for (const r of requirementsOf(id)) purgeRequirementData(r.id)
  repo.removeWhere<RequirementVersion>('requirements', (r) => r.projectId === id)
  repo.removeWhere<CompareReport>('compares', (r) => r.projectId === id)
  repo.remove('projects', id)
  res.json({ ok: true })
})

requirementsRouter.get('/projects/:id/requirements', (req, res) => {
  const projectId = String(req.params.id)
  if (!repo.findById<Project>('projects', projectId)) throw new AppError('项目不存在', 404)
  res.json(requirementsOf(projectId))
})

requirementsRouter.post('/projects/:id/requirements', async (req, res) => {
  const projectId = String(req.params.id)
  if (!repo.findById<Project>('projects', projectId)) throw new AppError('项目不存在', 404)

  const label = String(req.body?.label ?? '').trim()
  const rawText = String(req.body?.rawText ?? '')
  const fileName = String(req.body?.fileName ?? 'manual.txt')
  const base64 = req.body?.base64 as string | undefined

  if (!label) throw new AppError('版本标签不能为空')

  let text = ''
  let sourceType: SourceType = 'paste'
  if (base64) {
    const parsed = await parseUploadedFile(base64, fileName)
    text = parsed.text
    sourceType = parsed.sourceType
  } else if (rawText) {
    text = normalizeText(rawText)
    sourceType = 'paste'
  } else {
    throw new AppError('未提供文档内容')
  }

  const chunks = chunkRequirement(text)
  if (!chunks.length) throw new AppError('未能从文档中提取到有效条款，请检查格式')

  const apiList = extractApis(text)
  const version: RequirementVersion = {
    id: genId('req'),
    projectId,
    label,
    sourceType,
    rawText: text,
    chunks,
    apiList,
    createdAt: nowIso(),
  }
  repo.insert('requirements', version)
  res.json(version)
})

requirementsRouter.get('/requirements/:id/analysis', (req, res) => {
  const requirement = repo.findById<RequirementVersion>('requirements', String(req.params.id))
  if (!requirement) throw new AppError('需求版本不存在', 404)
  res.json(requirement.analysis ?? null)
})

requirementsRouter.post('/requirements/:id/analysis', async (req, res) => {
  const parsed = z.object({ replaceAnalysisId: z.string().min(1).optional() }).safeParse(req.body ?? {})
  if (!parsed.success) throw new AppError('需求分析参数不正确')
  res.json(await analyzeRequirement(String(req.params.id), parsed.data.replaceAnalysisId))
})

requirementsRouter.patch('/requirements/:id/analysis/points/:pointId', async (req, res) => {
  res.json(await updateTestPoint(String(req.params.id), String(req.params.pointId), req.body))
})

requirementsRouter.delete('/requirements/:id', (req, res) => {
  const id = String(req.params.id)
  const reqVer = repo.findById<RequirementVersion>('requirements', id)
  if (!reqVer) throw new AppError('需求版本不存在', 404)
  purgeRequirementData(id)
  repo.remove('requirements', id)
  res.json({ ok: true })
})

requirementsRouter.post('/requirements/preview', async (req, res) => {
  const rawText = String(req.body?.rawText ?? '')
  const fileName = String(req.body?.fileName ?? 'preview.txt')
  const base64 = req.body?.base64 as string | undefined

  let text = ''
  if (base64) {
    const parsed = await parseUploadedFile(base64, fileName)
    text = parsed.text
  } else {
    text = normalizeText(rawText)
  }

  const chunks = chunkRequirement(text)
  const apiList = extractApis(text)
  res.json({ chunks, apiList, previewCount: chunks.length })
})

requirementsRouter.get('/demo', (_req, res) => {
  const demoDir = path.resolve(config.dataDir, '../demo-data')
  if (!fs.existsSync(demoDir)) {
    res.json([])
    return
  }
  const files = fs
    .readdirSync(demoDir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
    .map((name) => {
      const full = path.join(demoDir, name)
      const text = fs.readFileSync(full, 'utf8')
      const label = name.replace(/\.(md|txt)$/i, '')
      return { name, label, text }
    })
  res.json(files)
})
