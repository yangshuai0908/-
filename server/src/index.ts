import fs from 'node:fs'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { config, envFileLoaded, llmReady, rootDir } from './config.js'
import { requirementsRouter } from './modules/requirements/index.js'
import { casesRouter, generateRouter, exportRouter } from './modules/cases/index.js'
import { reviewRouter, compareRouter, assessmentRouter } from './modules/review/index.js'
import { agentRouter } from './modules/agent/index.js'
import { AppError } from './utils.js'

fs.mkdirSync(config.dataDir, { recursive: true })

const app = express()

app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/health', (_req: Request, res: Response) => {
  const llm = llmReady()
  res.json({
    ok: true,
    llm,
    model: config.model,
    envFile: envFileLoaded,
    rootDir,
    dataDir: config.dataDir,
  })
})

app.use('/api', requirementsRouter)
app.use('/api', generateRouter)
app.use('/api', casesRouter)
app.use('/api', exportRouter)
app.use('/api', compareRouter)
app.use('/api', reviewRouter)
app.use('/api', agentRouter)
app.use('/api', assessmentRouter)

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: '接口不存在' })
})

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof AppError ? err.status : 500
  const msg = err instanceof Error ? err.message : '服务器内部错误'
  if (status >= 500) console.error('[error]', err)
  res.status(status).json({ error: msg })
})

app.listen(config.port, () => {
  const llm = llmReady()
  console.log(`\n  TestPilot server  →  http://127.0.0.1:${config.port}`)
  console.log(`  项目根目录        →  ${rootDir}`)
  console.log(`  .env              →  ${envFileLoaded ?? '未找到（使用默认值）'}`)
  console.log(`  模型              →  ${config.model}`)
  console.log(`  模型状态          →  ${llm.ready ? '就绪' : '不可用：' + llm.reason}\n`)
})
