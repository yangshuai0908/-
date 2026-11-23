import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderAgentReply } from './reply'

const denseReply = `我是 TestPilot 的专业级 QA 智能架构师 Agent，我可以帮你完成以下工作：1. 需求分析：深入分析需求文档，自动拆解出带原文依据的候选测试点，并识别潜在问题；2. 测试用例管理：读取、搜索和评估现有测试用例，根据测试点自动生成四象限用例（正常、异常、边界、权限），精准新增特定场景的高质量测试用例，优化、改写、细化现有用例；3. 覆盖率分析：计算需求覆盖率，识别未覆盖的条款；4. 版本对比：对比不同版本需求之间的差异；5. 批量操作：批量确认或排除测试点；6. 漏洞扫描：深度走查需求中的逻辑漏洞、规则矛盾、时序与并发隐患等风险；7. 端到端自动化流程：一键完成从需求分析到测试用例生成、质量评估的全流程。当前项目是「用户中心」，包含两个需求版本：v1.0（15个需求块）和v-test-01（5个需求块）。我可以直接对测试资产进行读写和改动，不只是提供建议，而是能实际执行操作。有什么具体需求我可以帮你处理吗？`

test('the reported no-space reply separates seven capabilities from project context', () => {
  const html = renderAgentReply(denseReply)
  assert.equal((html.match(/<li>/g) || []).length, 7)
  assert.match(html, /<strong>需求分析<\/strong><br>\n深入分析/)
  assert.match(html, /<\/ol>\s*<p>当前项目是「用户中心」/)
  assert.match(html, /v1\.0（15个需求块）和v-test-01（5个需求块）/)
  assert.match(html, /<p>我可以直接对测试资产/)
  assert.match(html, /<p>有什么具体需求/)
  assert.equal((renderAgentReply('可做：1.分析；2.生成；3.评审').match(/<li>/g) || []).length, 3)
})

test('agent replies display paragraphs, lists and emphasis, including old inline lists', () => {
  const html = renderAgentReply('可以协助以下工作： 1. 需求分析：拆解测试点。 2. 用例管理：生成用例。 3. 覆盖检查：定位遗漏。')
  assert.match(html, /<p>可以协助以下工作：<\/p>/)
  assert.equal((html.match(/<li>/g) || []).length, 3)
  assert.match(html, /<strong>需求分析<\/strong>/)
  const markdown = renderAgentReply('### 当前结果\n\n已读取 **2 个版本**。\n\n- v1.0\n- v-test-01\n\n下一步请核对范围。')
  assert.match(markdown, /<h3>当前结果<\/h3>/)
  assert.match(markdown, /<strong>2 个版本<\/strong>/)
  assert.match(markdown, /<ul>/)
  assert.match(markdown, /<p>下一步请核对范围。<\/p>/)
  assert.match(renderAgentReply('版本 1.0，超时 1.5 秒。'), /版本 1\.0，超时 1\.5 秒。/)
})

test('model HTML and unsafe links stay inert; code and partial streams remain readable', () => {
  const html = renderAgentReply('<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[点击](javascript:alert(1))')
  assert.doesNotMatch(html, /<img|<script|href="javascript:/)
  assert.match(html, /&lt;img/)
  const code = '示例：\n\n```text\n 1. code 2. unchanged\n```\n\n`1. inline 2. unchanged`'
  assert.match(renderAgentReply(code), / 1\. code 2\. unchanged/)
  assert.match(renderAgentReply(code), /<code>1\. inline 2\. unchanged<\/code>/)
  assert.match(renderAgentReply('```text\n1. partial'), /<pre><code/)
})
