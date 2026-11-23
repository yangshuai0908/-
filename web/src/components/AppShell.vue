<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSelect, NSpin, NTabPane, NTabs, useDialog, useMessage } from 'naive-ui'
import { api } from '../api/client'
import { activeTab, canvasFocus, currentProjectId, currentRequirement, currentRequirementId, projects, requirements, requirementsRevision, selectedAgentResult } from '../stores/workspace'
import type { HealthInfo } from '../types'
import AppWorkflowStepper from './AppWorkflowStepper.vue'

const AgentView = defineAsyncComponent(() => import('../views/AgentView.vue'))
const RequirementView = defineAsyncComponent(() => import('../views/RequirementView.vue'))
const CasesView = defineAsyncComponent(() => import('../views/CasesView.vue'))
const CompareView = defineAsyncComponent(() => import('../views/CompareView.vue'))
const ReviewView = defineAsyncComponent(() => import('../views/ReviewView.vue'))
const RequirementAnalysisPanel = defineAsyncComponent(() => import('./RequirementAnalysisPanel.vue'))
const AgentResult = defineAsyncComponent(() => import('./AgentResult.vue'))

const message = useMessage(), dialog = useDialog()
const loading = ref(true), creating = ref(false), showCreate = ref(false), projectName = ref('')
const health = ref<HealthInfo | null>(null)
const projectOptions = computed(() => projects.value.map(item => ({ label: item.name, value: item.id })))
const requirementOptions = computed(() => requirements.value.map(item => ({ label: item.label, value: item.id })))
let requirementRequest = 0
async function loadRequirements() {
  const projectId = currentProjectId.value, request = ++requirementRequest
  if (!projectId) { requirements.value = []; currentRequirementId.value = null; return }
  try {
    const list = await api.listRequirements(projectId)
    if (request !== requirementRequest || currentProjectId.value !== projectId) return
    requirements.value = list
    if (!list.some(item => item.id === currentRequirementId.value)) currentRequirementId.value = list[0]?.id || null
  } catch (e) { if (request === requirementRequest) message.error((e as Error).message) }
}
async function createProject() {
  if (!projectName.value.trim() || creating.value) return
  creating.value = true
  try {
    const item = await api.createProject(projectName.value.trim())
    projects.value = [...projects.value, item]; currentProjectId.value = item.id
    showCreate.value = false; projectName.value = ''
  } catch (e) { message.error((e as Error).message) }
  finally { creating.value = false }
}
function deleteProject() {
  const item = projects.value.find(item => item.id === currentProjectId.value)
  if (!item) return
  dialog.warning({ title: '删除项目', content: `确认删除「${item.name}」及其需求、用例和报告？`, positiveText: '删除', negativeText: '取消', onPositiveClick: async () => {
    try { await api.deleteProject(item.id); projects.value = projects.value.filter(project => project.id !== item.id); currentProjectId.value = projects.value[0]?.id || null }
    catch (e) { message.error((e as Error).message) }
  } })
}
watch(currentProjectId, () => { currentRequirementId.value = null; void loadRequirements() })
watch(requirementsRevision, loadRequirements)
onMounted(async () => {
  const results = await Promise.allSettled([api.health(), api.listProjects()])
  if (results[0].status === 'fulfilled') health.value = results[0].value
  else message.error('后端连接失败，请检查服务状态')
  if (results[1].status === 'fulfilled') {
    projects.value = results[1].value
    if (!projects.value.some(item => item.id === currentProjectId.value)) currentProjectId.value = projects.value[0]?.id || null
    else await loadRequirements()
  } else message.error(results[1].reason instanceof Error ? results[1].reason.message : '读取项目失败')
  loading.value = false
})
</script>

<template>
  <div class="shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-badge">TP</span>
        <div class="brand-text">
          <div class="brand-title">TestPilot <span class="brand-tag">Copilot</span></div>
          <small class="brand-sub">需求驱动的可追溯测试工程平台</small>
        </div>
      </div>
      <div class="project-context">
        <n-select v-model:value="currentProjectId" :options="projectOptions" placeholder="选择项目" size="small" />
        <n-select v-model:value="currentRequirementId" :options="requirementOptions" placeholder="选择需求版本" size="small" clearable />
        <n-button size="small" secondary @click="showCreate = true">+ 新建项目</n-button>
        <n-button v-if="currentProjectId" size="small" quaternary @click="deleteProject">删除项目</n-button>
      </div>
      <div class="header-status">
        <div class="model-status" :class="{ ready: health?.llm.ready }">
          <span class="status-beacon" />
          <span class="model-name">{{ health?.llm.ready ? health.model : '模型未就绪' }}</span>
        </div>
      </div>
    </header>

    <div v-if="loading" class="loading"><n-spin size="large" /></div>
    <div v-else class="workspace">
      <aside class="agent-panel"><AgentView /></aside>
      <section class="results" aria-label="需求与测试成果">
        <!-- 业务生命周期流水线 -->
        <AppWorkflowStepper />

        <div class="results-heading">
          <div class="heading-left">
            <strong>{{ currentRequirement?.label || '未选择需求版本' }}</strong>
            <span class="heading-desc">{{ currentRequirement ? '当前版本工作成果' : '请先在上方或需求资料中导入需求' }}</span>
          </div>
          <div v-if="canvasFocus" class="focus-pill">
            <span class="focus-type-tag">聚焦</span>
            <span class="focus-title">{{ canvasFocus.title }}</span>
          </div>
        </div>

        <n-tabs v-model:value="activeTab" type="line" class="result-tabs" pane-style="padding: 0">
          <n-tab-pane name="requirement" tab="需求资料" display-directive="show:lazy" class="pane-requirement"><RequirementView @refresh="loadRequirements" /></n-tab-pane>
          <n-tab-pane name="points" tab="测试点" display-directive="show:lazy"><RequirementAnalysisPanel v-if="currentRequirement" :key="currentRequirement.id" :requirement="currentRequirement" /><div v-else class="empty">先在需求资料中保存或选择需求版本</div></n-tab-pane>
          <n-tab-pane name="cases" tab="测试用例" display-directive="show:lazy"><CasesView /></n-tab-pane>
          <n-tab-pane name="review" tab="质量评审" display-directive="show:lazy"><ReviewView /></n-tab-pane>
          <n-tab-pane name="compare" tab="版本对比" display-directive="show:lazy"><CompareView /></n-tab-pane>
          <n-tab-pane v-if="selectedAgentResult?.artifact?.view === 'insights'" name="insights" tab="分析结果" display-directive="show:lazy"><AgentResult :action="selectedAgentResult" /></n-tab-pane>
        </n-tabs>
      </section>
    </div>
    <n-modal v-model:show="showCreate" preset="card" title="新建项目" style="width:420px" :bordered="false"><n-input v-model:value="projectName" placeholder="项目名称" @keyup.enter="createProject" /><template #footer><div class="modal-actions"><n-button @click="showCreate = false">取消</n-button><n-button type="primary" :loading="creating" @click="createProject">创建</n-button></div></template></n-modal>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f4f6f9;
}
.app-header {
  height: 58px;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 24px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}
.brand { display: flex; align-items: center; gap: 12px; min-width: 220px; }
.brand-badge {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
  color: white;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  box-shadow: 0 2px 4px rgba(37,99,235,0.25);
}
.brand-title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.2;
}
.brand-tag {
  font-size: 10px;
  padding: 1px 5px;
  background: #f1f5f9;
  color: #475569;
  border-radius: 4px;
  font-weight: 600;
}
.brand-sub { color: #94a3b8; font-size: 11px; margin-top: 2px; display: block; }

.project-context { display: flex; align-items: center; gap: 8px; flex: 1; }
.project-context :deep(.n-select) { width: 185px; }

.header-status { display: flex; align-items: center; gap: 12px; }
.model-status {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  font-size: 11px;
  color: #64748b;
}
.model-status.ready {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #166534;
}
.status-beacon {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
}
.model-status.ready .status-beacon {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
  animation: pulseBeacon 2s infinite ease-in-out;
}
@keyframes pulseBeacon {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
.model-name { font-weight: 500; font-family: ui-monospace, SFMono-Regular, monospace; }

.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  height: calc(100% - 58px);
  overflow: hidden;
}
.agent-panel {
  width: 38%;
  min-width: 360px;
  max-width: 620px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid #e2e8f0;
  background: #ffffff;
  flex-shrink: 0;
}
.results {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f8fafc;
}
.results-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 14px 24px 6px;
  flex-shrink: 0;
}
.heading-left strong { font-size: 15px; font-weight: 700; color: #1e293b; }
.heading-desc { font-size: 12px; color: #64748b; margin-left: 10px; }

.focus-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 3px 8px;
  border-radius: 6px;
  max-width: 45%;
}
.focus-type-tag {
  font-size: 10px;
  font-weight: 700;
  color: #1d4ed8;
  background: #dbeafe;
  padding: 1px 4px;
  border-radius: 3px;
}
.focus-title {
  font-size: 12px;
  color: #1e40af;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 24px;
}
.result-tabs :deep(.n-tabs-nav) {
  display: none !important;
}
.result-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.result-tabs :deep(.n-tab-pane) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 6px !important;
  padding-bottom: 32px;
  box-sizing: border-box;
}
.result-tabs :deep(.n-tab-pane.pane-requirement) {
  overflow: hidden !important;
  padding-bottom: 0 !important;
  display: flex;
  flex-direction: column;
}
.result-tabs :deep(.n-tabs-tab) { font-size: 13px; font-weight: 500; }

.loading { display: grid; place-items: center; flex: 1; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

@media(max-width: 1100px) {
  .app-header { padding-inline: 16px; gap: 14px; }
  .brand { min-width: 140px; }
  .project-context :deep(.n-select) { width: 140px; }
  .agent-panel { min-width: 320px; width: 42%; }
  .result-tabs, .results-heading { padding-inline: 16px; }
}
@media(max-width: 768px) {
  .workspace { flex-direction: column; overflow: auto; }
  .agent-panel { width: 100%; max-width: none; min-width: 0; height: 50vh; min-height: 360px; border-right: 0; border-bottom: 1px solid #e2e8f0; }
  .results { min-height: 50vh; }
}
</style>
