import { Router } from 'express'
import { generationPlan, generateConfirmedCases } from '../modules/cases/generation.js'
import * as repo from '../store/fsRepo.js'
import type { RequirementVersion } from '../store/schema.js'
import { AppError, CATEGORIES, type Category } from '../utils.js'
export { buildCase } from '../modules/cases/buildCase.js'

export const generateRouter = Router()

function categoriesOf(input: unknown): Category[] {
  return Array.isArray(input) ? [...new Set(input.filter((value): value is Category => CATEGORIES.includes(value)))] : [...CATEGORIES]
}

generateRouter.post('/generate', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  const send = (event: unknown) => { if (!res.writableEnded && !res.destroyed) res.write('data: ' + JSON.stringify(event) + '\n\n') }
  try {
    const requirement = repo.findById<RequirementVersion>('requirements', String(req.body?.requirementId ?? ''))
    if (!requirement) throw new AppError('需求版本不存在', 404)
    await generateConfirmedCases(requirement, categoriesOf(req.body?.categories), Boolean(req.body?.overwrite), send)
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    res.end()
  }
})

generateRouter.post('/generate/estimate', (req, res) => {
  const requirement = repo.findById<RequirementVersion>('requirements', String(req.body?.requirementId ?? ''))
  if (!requirement) throw new AppError('需求版本不存在', 404)
  const plan = generationPlan(requirement, categoriesOf(req.body?.categories))
  res.json({ chunks: requirement.chunks.length, points: plan.points.length, pending: plan.pending, excluded: plan.excluded, batches: plan.batches.length, calls: plan.batches.length })
})
