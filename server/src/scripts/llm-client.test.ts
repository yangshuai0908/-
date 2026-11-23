import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../config.js'
import { chat, streamChat } from '../llm/client.js'

test('模型适配统一思考开关，空内容截断与流式中断不能作为成功结果', async t => {
  const previous = { ...config }, originalFetch = globalThis.fetch
  Object.assign(config, { apiKey: 'isolated-llm-fixture', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', thinking: 'disabled', maxTokens: 4096 })
  let requests: Record<string, any>[] = []
  let respond = () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return respond() }
  const messages = [{ role: 'user' as const, content: '只输出 JSON' }]
  const frame = (delta: unknown, finishReason: string | null = null) => 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] }) + '\n\n'
  try {
    await t.test('DeepSeek 和智谱的普通及流式请求均按配置关闭思考', async () => {
      for (const baseUrl of ['https://api.deepseek.com/v1', 'https://open.bigmodel.cn/api/paas/v4']) {
        Object.assign(config, { baseUrl, thinking: 'disabled' })
        respond = () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })
        assert.equal(await chat({ messages, jsonMode: true }), '{"ok":true}')
        assert.deepEqual(requests.at(-1)!.thinking, { type: 'disabled' })
        respond = () => new Response(frame({ content: '{"ok":true}' }, 'stop') + 'data: [DONE]')
        assert.equal(await streamChat({ messages, jsonMode: true }, () => {}), '{"ok":true}')
        assert.deepEqual(requests.at(-1)!.thinking, { type: 'disabled' })
        assert.deepEqual(requests.at(-1)!.response_format, { type: 'json_object' })
      }
    })
    await t.test('显式开启也传递给已知接口，其他兼容接口不附加厂商参数', async () => {
      Object.assign(config, { baseUrl: 'https://api.deepseek.com/v1', thinking: 'enabled' })
      respond = () => Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })
      await chat({ messages })
      assert.deepEqual(requests.at(-1)!.thinking, { type: 'enabled' })
      for (const baseUrl of ['https://generic-fixture.invalid/v1', 'https://bigmodel.cn.other-fixture.invalid/v1']) {
        Object.assign(config, { baseUrl })
        await chat({ messages })
        assert.equal('thinking' in requests.at(-1)!, false)
      }
    })
    await t.test('截图中的空 content 加 length 被准确识别为截断，不重复请求或误报空内容', async () => {
      Object.assign(config, { baseUrl: 'https://api.deepseek.com/v1', thinking: 'disabled' })
      requests = []
      respond = () => Response.json({ choices: [{ message: { content: '', reasoning_content: '固定样本，不记录思考内容' }, finish_reason: 'length' }] })
      await assert.rejects(chat({ messages }), error => {
        assert.match((error as Error).message, /截断.*max_tokens=4096/)
        assert.doesNotMatch((error as Error).message, /内容为空/)
        return true
      })
      assert.equal(requests.length, 1)
      respond = () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'length' }] })
      await assert.rejects(chat({ messages }), /截断/)
      respond = () => Response.json({ choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] })
      await assert.rejects(chat({ messages }), /内容为空.*stop/)
    })
    await t.test('流式截断不能因有部分正文或结束标记就视为成功', async () => {
      for (const content of ['', '{"type":"final","message":"部分正文"}']) {
        respond = () => new Response(frame({ reasoning_content: '固定样本，不输出思考内容' }) + frame({ content }, 'length') + 'data: [DONE]')
        const deltas: string[] = []
        await assert.rejects(streamChat({ messages }, delta => deltas.push(delta)), /截断/)
        assert(!deltas.join('').includes('思考内容'))
      }
    })
    await t.test('流式分段与末尾无换行正常解析，中断和回调错误不会被吞掉', async () => {
      const source = ': heartbeat\n\n' + frame({ content: '需求' }) + frame({ content: '分析' }, 'stop') + 'data: [DONE]'
      respond = () => new Response(new ReadableStream({ start(controller) {
        const bytes = new TextEncoder().encode(source)
        for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7))
        controller.close()
      } }))
      const deltas: string[] = []
      assert.equal(await streamChat({ messages }, delta => deltas.push(delta)), '需求分析')
      assert.equal(deltas.join(''), '需求分析')
      respond = () => new Response(frame({ content: '中途断开' }))
      await assert.rejects(streamChat({ messages }, () => {}), /提前中断/)
      respond = () => new Response('data: invalid-json\n\n' + frame({ content: '不能跳过损坏的事件' }, 'stop'))
      await assert.rejects(streamChat({ messages }, () => {}), /无法解析/)
      respond = () => new Response(frame({ content: '正文' }, 'stop'))
      await assert.rejects(streamChat({ messages }, () => { throw new Error('页面同步失败') }), /页面同步失败/)
    })
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(config, previous)
  }
})
