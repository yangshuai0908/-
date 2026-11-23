<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import type { AgentAction, Category, RiskIssue, RiskResolutionInput, RiskScan } from '../types'
import { api } from '../api/client'
import { activeTab, currentProjectId, currentRequirementId, requirements } from '../stores/workspace'

const props = defineProps<{ action: AgentAction }>()
const message = useMessage()
const requirement = computed(() => requirements.value.find(r => r.id === props.action.artifact?.requirementId && r.projectId === currentProjectId.value))
const savedScan = computed(() => requirement.value?.riskScans?.find(s => s.id === props.action.data?.id))
const scan = computed<RiskScan>(() => savedScan.value ?? props.action.data)
const kinds = { needs_clarification: '规则待澄清', rule_conflict: '规则可能冲突', test_suggestion: '补充测试建议', covered: '相关章节已说明' }
const statuses = { question: '待澄清', point: '已补充待确认测试点', covered: '已核对覆盖', ignored: '已忽略' }
const severity = { critical: '很高', high: '高', medium: '中', low: '低' }
const editor = ref<{ issueId: string; action: RiskResolutionInput['action'] } | null>(null)
const saving = ref(false), error = ref('')
const form = reactive({ title: '', objective: '', category: 'abnormal' as Category, question: '', comment: '', evidence: [] as { reqId: string; quote: string }[] })
const chunkOptions = computed(() => requirement.value?.chunks.map(c => ({ label: `${c.reqId} · ${c.sectionPath}`, value: c.reqId })) ?? [])
const issueInEditor = computed(() => scan.value?.issues.find(i => i.id === editor.value?.issueId))
const editorTitle = ref('')
watch(() => props.action, () => { editor.value = null; error.value = '' })

function pointExists(issue: RiskIssue) {
  return requirement.value?.analysis?.sections.some(s => s.points.some(p => p.id === issue.resolution?.pointId)) ?? false
}
function canHandle(issue: RiskIssue) {
  return !issue.resolution || issue.resolution.action === 'question' || (issue.resolution.action === 'point' && !pointExists(issue))
}
function openEditor(issue: RiskIssue, action: RiskResolutionInput['action']) {
  if (!savedScan.value) return
  editorTitle.value = { question: '加入待澄清问题', point: '补充候选测试点', covered: '核对已覆盖规则', ignored: '忽略建议' }[action]
  error.value = ''
  Object.assign(form, {
    title: issue.defensiveCase?.title ?? '', objective: '', category: issue.defensiveCase?.category ?? 'abnormal',
    question: issue.question, comment: '',
    evidence: issue.evidence.length ? issue.evidence.map(({ reqId, quote }) => ({ reqId, quote })) : [{ reqId: issue.reqId, quote: '' }],
  })
  editor.value = { issueId: issue.id, action }
}
function goToPoints() {
  if (requirement.value) { currentRequirementId.value = requirement.value.id; activeTab.value = 'points' }
}
async function save() {
  const req = requirement.value, selected = editor.value, scanId = savedScan.value?.id
  if (!req || !selected || !scanId || saving.value) return
  saving.value = true; error.value = ''
  try {
    const payload: RiskResolutionInput = { action: selected.action, comment: form.comment, question: form.question }
    if (selected.action === 'point') payload.point = { title: form.title, objective: form.objective, category: form.category, evidence: form.evidence }
    if (selected.action === 'covered') payload.evidence = form.evidence
    const result = await api.resolveRisk(req.id, scanId, selected.issueId, payload)
    // 切换版本或项目后，异步结果只更新原需求，不改变当前选择。
    const index = requirements.value.findIndex(r => r.id === req.id && r.projectId === req.projectId)
    if (index >= 0) requirements.value[index] = result
    editor.value = null
    message.success(selected.action === 'point' ? '已保存为待确认测试点，请核对后人工确认' : '已保存处理结果')
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败，请重试' }
  finally { saving.value = false }
}
</script>

<template>
  <div class="risk-result">
    <div class="next-step">
      <strong>下一步：核对建议，再决定补测试点还是先澄清规则。</strong>
      <p>扫描是补充检查。未验证的风险不代表实际漏洞；候选场景不会自动进入用例库。</p>
      <n-button size="small" type="primary" @click="goToPoints">{{ requirement?.analysis ? '前往核对测试点' : '先分析需求、提炼测试点' }} →</n-button>
    </div>
    <p>{{ scan.summary }}</p>
    <p v-if="savedScan" class="scope">已保存 · 本次参考 {{ scan.includedReqIds.length }}/{{ scan.totalChunks }} 个条款。{{ scan.contextTruncated ? '上下文有截断，不能据此认定全文缺少某项规则。' : '已提供当前版本全部条款，仍需人工核对模型判断。' }}</p>
    <p v-else class="warning">这是旧版扫描记录，仅可查看。请重新扫描以保存建议并使用后续处理。</p>
    <p v-if="!scan.issues?.length">本次未提出风险建议；这不代表需求已完整或实现没有缺陷。</p>
    <article v-for="(issue, index) in scan.issues" :key="issue.id || index" class="risk-issue">
      <div class="issue-meta">{{ issue.reqId }} · {{ issue.location }} · {{ kinds[issue.findingKind] || '待核对建议' }} · 建议关注程度：{{ severity[issue.severity] || issue.severity }}</div>
      <h3>{{ issue.description }}</h3>
      <p>{{ issue.riskImpact }}</p>
      <div v-if="issue.question" class="question"><strong>待核查问题：</strong>{{ issue.question }}</div>
      <details v-if="issue.evidence?.length">
        <summary>核对引用原文</summary>
        <blockquote v-for="(e, i) in issue.evidence" :key="i">{{ e.reqId }} · {{ e.matched ? '已定位原文' : '未匹配原文，需修正' }}<br>{{ e.quote }}</blockquote>
      </details>
      <details v-if="issue.defensiveCase">
        <summary>候选防御场景：{{ issue.defensiveCase.title }}</summary>
        <p>前置：{{ issue.defensiveCase.precondition }}</p>
        <ol><li v-for="(step, i) in issue.defensiveCase.steps" :key="i">{{ step }}</li></ol>
        <p>候选预期（需核对）：{{ issue.defensiveCase.expected.join('；') }}</p>
      </details>
      <div v-if="issue.resolution" class="resolution" role="status">
        {{ statuses[issue.resolution.action] }}<span v-if="issue.resolution.comment"> · {{ issue.resolution.comment }}</span>
        <p v-if="issue.resolution.action === 'point' && !pointExists(issue)">原测试点已不在当前分析中，请重新核对并处理。</p>
        <n-button v-if="issue.resolution.action === 'point' && pointExists(issue)" text type="primary" @click="goToPoints">去测试点页核对 →</n-button>
      </div>
      <div v-if="savedScan && canHandle(issue)" class="actions">
        <n-button v-if="issue.resolution?.action !== 'question'" size="small" @click="openEditor(issue, 'question')">加入待澄清</n-button>
        <n-button size="small" :disabled="!requirement?.analysis" @click="openEditor(issue, 'point')">补充测试点</n-button>
        <n-button size="small" @click="openEditor(issue, 'covered')">标记已覆盖</n-button>
        <n-button size="small" @click="openEditor(issue, 'ignored')">忽略并说明原因</n-button>
        <span v-if="!requirement?.analysis" class="scope">先完成需求分析，才能补充候选测试点。</span>
      </div>
    </article>

    <n-modal :show="Boolean(editor)" preset="card" :title="editorTitle" style="width: 660px; max-width: 94vw" :mask-closable="!saving" :closable="!saving" @update:show="show => { if (!show && !saving) editor = null }">
      <form v-if="editor" class="resolution-form" @submit.prevent="save">
        <p>{{ issueInEditor?.description }}</p>
        <template v-if="editor?.action === 'point'">
          <p class="scope">保存后为待确认状态。请填写实际要验证的规则；待澄清问题会随测试点保留，人工确认时仍需填写澄清结论。</p>
          <label>测试点名称<n-input v-model:value="form.title" :maxlength="200" placeholder="填写独立的测试目标" /></label>
          <label>验证目标<n-input v-model:value="form.objective" type="textarea" :maxlength="1000" placeholder="明确适用条件及要验证的行为，避免补写未经确认的规则" /></label>
          <label>分类<select v-model="form.category"><option value="normal">正常</option><option value="abnormal">异常</option><option value="boundary">边界</option><option value="permission">权限</option></select></label>
        </template>
        <label v-if="editor?.action === 'question' || editor?.action === 'point'">{{ editor.action === 'question' ? '需要向需求方澄清的问题' : '仍需澄清的问题（如有）' }}<n-input v-model:value="form.question" type="textarea" :maxlength="500" placeholder="具体缺少哪个条件、权限范围或处理规则？" /></label>
        <template v-if="editor?.action === 'point' || editor?.action === 'covered'">
          <div v-for="(source, i) in form.evidence" :key="i" class="source-editor">
            <label>引用条款 {{ i + 1 }}<n-select v-model:value="source.reqId" :options="chunkOptions" /></label>
            <details><summary>查看该条款原文</summary><p class="original">{{ requirement?.chunks.find(c => c.reqId === source.reqId)?.text }}</p></details>
            <label>连续原文引用<n-input v-model:value="source.quote" type="textarea" :maxlength="1800" placeholder="从条款中复制与该验证目标相关的连续原文" /></label>
            <n-button v-if="form.evidence.length > 1" size="tiny" @click="form.evidence.splice(i, 1)">移除此引用</n-button>
          </div>
          <n-button v-if="form.evidence.length < 8" size="small" @click="form.evidence.push({ reqId: issueInEditor?.reqId || '', quote: '' })">添加另一条依据</n-button>
        </template>
        <label>处理说明{{ editor?.action === 'ignored' || editor?.action === 'covered' ? '（必填）' : '（选填）' }}<n-input v-model:value="form.comment" type="textarea" :maxlength="2000" placeholder="填写核对结论、已覆盖位置或忽略原因" /></label>
        <p v-if="error" class="warning" role="alert">{{ error }}</p>
        <div class="actions"><n-button :disabled="saving" @click="editor = null">取消</n-button><n-button type="primary" attr-type="submit" :loading="saving">{{ editor?.action === 'point' ? '保存为待确认测试点' : '保存处理结果' }}</n-button></div>
      </form>
    </n-modal>
  </div>
</template>

<style scoped>
.risk-result { font-size: 13px; line-height: 1.8; }
.next-step { padding: 14px; background: #eff6ff; border-radius: 7px; }
.next-step p { margin: 6px 0 12px; }
.risk-issue { padding: 16px; margin: 14px 0; background: #f7f9fc; border: 1px solid #e3e9ef; border-radius: 7px; overflow-wrap: anywhere; }
h3 { font-size: 14px; margin: 8px 0; }
.issue-meta, .scope { color: #64748b; font-size: 12px; }
.warning { color: #9a3412; }
.question, .resolution { padding: 8px 0; }
.resolution { color: #365e6e; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
summary { cursor: pointer; color: #466b8b; }
blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid #cbd5e1; white-space: pre-wrap; }
.resolution-form { display: grid; gap: 12px; max-height: 70vh; overflow-y: auto; padding: 0 4px; }
label { display: grid; gap: 4px; font-size: 13px; }
select { padding: 7px; border: 1px solid #cbd5e1; border-radius: 4px; background: white; }
.source-editor { display: grid; gap: 8px; padding: 10px; background: #f8fafc; border-radius: 5px; }
.original { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow-y: auto; }
</style>
