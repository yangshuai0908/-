<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import {
  NButton,
  NInput,
  NModal,
  NSelect,
  NSpin,
  NTabPane,
  NTabs,
  type SelectRenderOption,
  useDialog,
  useMessage,
} from "naive-ui";
import { api } from "../api/client";
import {
  currentProject,
  currentProjectId,
  currentRequirementId,
  projects,
  requirements,
} from "../stores/workspace";
import type { HealthInfo } from "../types";
import RequirementView from "../views/RequirementView.vue";
import CasesView from "../views/CasesView.vue";
import CompareView from "../views/CompareView.vue";
import ReviewView from "../views/ReviewView.vue";
import AgentView from "../views/AgentView.vue";

const message = useMessage();
const dialog = useDialog();
const tab = ref("requirement");
const loading = ref(true);
const showAgent = ref(localStorage.getItem("tp_agent_open") === "true");
watch(showAgent, (val) => {
  try {
    localStorage.setItem("tp_agent_open", String(val));
  } catch (e) {
    // ignore
  }
});
const health = ref<HealthInfo | null>(null);
const navigation = [
  { key: "requirement", label: "需求管理", index: "01" },
  { key: "cases", label: "测试用例", index: "02" },
  { key: "compare", label: "版本对比", index: "03" },
  { key: "review", label: "质量评审", index: "04" },
];
const activeSection = computed(
  () => navigation.find((item) => item.key === tab.value)?.label ?? "",
);

const showCreate = ref(false);
const newProjectName = ref("");
const creating = ref(false);
const projectOptions = ref<{ label: string; value: string }[]>([]);
const requirementOptions = ref<{ label: string; value: string }[]>([]);

function syncProjectOptions() {
  projectOptions.value = projects.value.map((p) => ({
    label: p.name,
    value: p.id,
  }));
}

function syncRequirementOptions() {
  requirementOptions.value = requirements.value.map((r) => ({
    label: `${r.label} · ${r.chunks.length} 条条款`,
    value: r.id,
  }));
}

async function loadProjects() {
  projects.value = await api.listProjects();
  syncProjectOptions();
  if (!currentProjectId.value && projects.value.length)
    currentProjectId.value = projects.value[0].id;
}

async function loadRequirements() {
  if (!currentProjectId.value) {
    requirements.value = [];
    syncRequirementOptions();
    return;
  }
  requirements.value = await api.listRequirements(currentProjectId.value);
  syncRequirementOptions();
  if (!requirements.value.some((r) => r.id === currentRequirementId.value)) {
    currentRequirementId.value = requirements.value[0]?.id ?? null;
  }
}

async function createProject() {
  const name = newProjectName.value.trim();
  if (!name) {
    message.warning("请填写项目名称");
    return;
  }
  creating.value = true;
  try {
    const p = await api.createProject(name);
    showCreate.value = false;
    newProjectName.value = "";
    await loadProjects();
    currentProjectId.value = p.id;
    message.success("项目已创建");
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    creating.value = false;
  }
}

function deleteProject(projectId: string) {
  const selected = projects.value.find((p) => p.id === projectId);
  if (!selected) return;
  dialog.warning({
    title: "删除项目",
    content: `确认删除「${selected.name}」？该项目的需求版本、测试用例和报告会一并删除。`,
    positiveText: "删除项目",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await api.deleteProject(selected.id);
        projects.value = projects.value.filter((p) => p.id !== selected.id);
        syncProjectOptions();
        if (currentProjectId.value === selected.id)
          currentProjectId.value = projects.value[0]?.id ?? null;
        if (!projects.value.length) showCreate.value = true;
        message.success("项目已删除");
      } catch (e) {
        message.error((e as Error).message);
      }
    },
  });
}

const renderProjectOption: SelectRenderOption = ({ node, option }) =>
  h("div", { class: "project-option" }, [
    node,
    h(
      "button",
      {
        class: "project-option-delete",
        type: "button",
        title: `删除「${String(option.label ?? "项目")}」`,
        "aria-label": `删除「${String(option.label ?? "项目")}」`,
        onMousedown: (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
        },
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          if (option.value !== undefined) deleteProject(String(option.value));
        },
      },
      "×",
    ),
  ]);

watch(currentProjectId, async () => {
  currentRequirementId.value = null;
  await loadRequirements();
});

onMounted(async () => {
  try {
    health.value = await api.health();
    if (!health.value.llm.ready) message.warning(health.value.llm.reason);
  } catch {
    message.error("后端未启动，请检查 server 是否在 3001 端口运行");
  }
  try {
    await loadProjects();
    await loadRequirements();
    if (!projects.value.length) showCreate.value = true;
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    loading.value = false;
  }
});

function refreshRequirements() {
  return loadRequirements();
}
defineExpose({ refreshRequirements });
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo">TP</span>
        <div>
          <div class="title">TestPilot</div>
          <div class="subtitle">测试管理工作台</div>
        </div>
      </div>

      <div class="project-control">
        <n-select
          v-model:value="currentProjectId"
          :options="projectOptions"
          :render-option="renderProjectOption"
          placeholder="选择项目"
          size="medium"
        />
        <n-button
          size="small"
          secondary
          class="new-project"
          @click="showCreate = true"
          >＋ 新建项目</n-button
        >
      </div>

      <div class="nav-label">工作区</div>
      <nav class="side-nav" aria-label="工作区模块">
        <button
          v-for="item in navigation"
          :key="item.key"
          type="button"
          :class="{ active: tab === item.key }"
          @click="tab = item.key"
        >
          <span class="nav-index">{{ item.index }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-foot">
        <span
          class="status-dot"
          :class="health?.llm.ready ? 'ready' : 'offline'"
        />
        <div>
          <div class="status-title">
            {{ health?.llm.ready ? "服务已连接" : "服务状态" }}
          </div>
          <div class="status-subtitle">
            {{ health?.llm.ready ? health.model : "请配置模型" }}
          </div>
        </div>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div class="page-context">
          <span class="context-label">{{ activeSection }}</span>
          <span class="context-project">{{
            currentProject?.name || "请选择项目"
          }}</span>
        </div>
        <div class="controls">
          <n-select
            v-model:value="currentRequirementId"
            :options="requirementOptions"
            placeholder="选择需求版本"
            size="small"
            clearable
            style="width: 230px"
          />
        </div>
      </header>

      <main class="content">
        <n-spin v-if="loading" style="display: block; margin-top: 80px" />
        <n-tabs
          v-else
          v-model:value="tab"
          class="workspace-tabs"
          type="line"
          animated
          pane-style="padding: 0"
        >
          <n-tab-pane name="requirement"
            ><RequirementView @refresh="loadRequirements"
          /></n-tab-pane>
          <n-tab-pane name="cases"><CasesView /></n-tab-pane>
          <n-tab-pane name="compare"><CompareView /></n-tab-pane>
          <n-tab-pane name="review"><ReviewView /></n-tab-pane>
        </n-tabs>
      </main>
    </section>

    <div class="agent-float">
      <transition name="popover-zoom">
        <section
          v-show="showAgent"
          class="agent-popover"
          aria-label="TestPilot Agent 对话面板"
        >
          <header class="agent-popover-head">
            <span><b>TP</b> TestPilot Agent</span>
            <button
              type="button"
              class="popover-close-btn"
              aria-label="收起 Agent"
              title="收起助手面板"
              @click="showAgent = false"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <AgentView compact />
        </section>
      </transition>

      <!-- 展开时完全隐藏此按钮；仅在收起时显示 -->
      <transition name="trigger-fade">
        <button
          v-show="!showAgent"
          class="agent-trigger"
          type="button"
          aria-expanded="false"
          title="打开 TestPilot Agent 助手"
          @click="showAgent = true"
        >
          <span class="trigger-mark">TP</span>
        </button>
      </transition>
    </div>

    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建项目"
      style="width: 420px"
      :bordered="false"
    >
      <n-input
        v-model:value="newProjectName"
        placeholder="例如：用户登录模块"
        @keyup.enter="createProject"
      />
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <n-button size="small" @click="showCreate = false">取消</n-button>
          <n-button
            size="small"
            type="primary"
            :loading="creating"
            @click="createProject"
            >创建</n-button
          >
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  background: var(--tp-bg);
}
.sidebar {
  width: 228px;
  flex: 0 0 228px;
  display: flex;
  flex-direction: column;
  padding: 24px 16px 14px;
  background: #f8f9fb;
  border-right: 1px solid var(--tp-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 7px 26px;
}
.logo {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: #243b53;
  color: white;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.subtitle {
  font-size: 11px;
  color: var(--tp-text-dim);
  margin-top: 3px;
}
.project-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px 24px;
}
.new-project {
  width: 100%;
}
:global(.project-option) {
  position: relative;
}
:global(.project-option .n-base-select-option) {
  padding-right: 58px;
}
:global(.project-option-delete) {
  position: absolute;
  top: 50%;
  right: 26px;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #9aa4af;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
:global(.project-option-delete:hover) {
  background: #fcebec;
  color: #b85858;
}
.nav-label {
  padding: 0 9px 8px;
  color: #8c96a3;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
}
.side-nav {
  display: grid;
  gap: 3px;
}
.side-nav button {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  border: 0;
  border-radius: 5px;
  padding: 10px 9px;
  background: transparent;
  color: #596574;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.side-nav button:hover {
  background: #edf1f5;
  color: #25374a;
}
.side-nav button.active {
  background: #e8eef4;
  color: #243b53;
  font-weight: 600;
}
.nav-index {
  width: 22px;
  color: #9aa4af;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.side-nav button.active .nav-index {
  color: #526b83;
}
.sidebar-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding: 13px 9px 5px;
  border-top: 1px solid var(--tp-border);
}
.status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: #c1c8d0;
}
.status-dot.ready {
  background: #4d9a73;
}
.status-dot.offline {
  background: #c27b59;
}
.status-title {
  font-size: 11px;
  font-weight: 600;
  color: #475363;
}
.status-subtitle {
  max-width: 165px;
  overflow: hidden;
  color: #8b95a1;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  min-height: 62px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 28px;
  border-bottom: 1px solid var(--tp-border);
  background: #fff;
  flex-shrink: 0;
}
.page-context {
  display: flex;
  align-items: baseline;
  gap: 13px;
  min-width: 0;
}
.context-label {
  color: #27384a;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}
.context-project {
  color: #8993a0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 28px;
}
.content :deep(.workspace-tabs > .n-tabs-nav) {
  display: none;
}
.content :deep(.n-tab-pane) {
  padding: 0;
}
.agent-float {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1000;
  pointer-events: none;
}
.agent-popover {
  position: absolute;
  right: 0;
  bottom: 0;
  width: min(540px, calc(100vw - 32px));
  height: min(720px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #d8dee5;
  border-radius: 12px;
  background: #fff;
  box-shadow:
    0 16px 48px rgba(15, 23, 42, 0.16),
    0 0 0 1px rgba(0, 0, 0, 0.05);
  pointer-events: auto;
}
.agent-popover-head {
  height: 44px;
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid #edf0f3;
  color: #334456;
  font-size: 12px;
  font-weight: 600;
  background: #ffffff;
}
.agent-popover-head span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.agent-popover-head b {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: #243b53;
  color: #fff;
  font-size: 9px;
}
.popover-close-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #7b8896;
  cursor: pointer;
  transition: all 0.15s ease;
}
.popover-close-btn:hover {
  background: #f1f4f7;
  color: #243b53;
}
.agent-trigger {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid #243b53;
  border-radius: 22px;
  padding: 8px 8px 8px 8px;
  background: #243b53;
  color: #fff;
  box-shadow: 0 4px 14px rgba(28, 41, 54, 0.2);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  pointer-events: auto;
  transition:
    transform 0.15s ease,
    background 0.15s ease;
}
.agent-trigger:hover {
  background: #304d69;
  transform: translateY(-1px);
}

.popover-zoom-enter-active,
.popover-zoom-leave-active {
  transition:
    opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: bottom right;
}
.popover-zoom-enter-from,
.popover-zoom-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.trigger-fade-enter-active,
.trigger-fade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
  transform-origin: bottom right;
}
.trigger-fade-enter-from,
.trigger-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
.trigger-mark {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.38);
  border-radius: 50%;
  font-size: 8px;
  letter-spacing: 0.02em;
}
@media (max-width: 760px) {
  .sidebar {
    width: 184px;
    flex-basis: 184px;
    padding-inline: 10px;
  }
  .topbar {
    padding-inline: 16px;
  }
  .content {
    padding-inline: 16px;
  }
}
@media (max-width: 560px) {
  .shell {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    flex: 0 0 auto;
    padding: 10px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--tp-border);
  }
  .brand {
    padding: 0 2px 10px;
  }
  .project-control {
    flex-direction: column;
    padding: 0 0 10px;
  }
  .project-control :deep(.n-select) {
    flex: 1;
    min-width: 0;
  }
  .new-project {
    width: auto;
  }
  .nav-label,
  .sidebar-foot {
    display: none;
  }
  .side-nav {
    display: flex;
    overflow-x: auto;
  }
  .side-nav button {
    width: auto;
    flex: 0 0 auto;
    padding: 8px;
  }
  .nav-index {
    display: none;
  }
  .topbar {
    min-height: 56px;
    padding-inline: 12px;
  }
  .page-context {
    display: none;
  }
  .controls {
    width: 100%;
    justify-content: flex-end;
  }
  .content {
    padding-inline: 10px;
  }
  .agent-float {
    right: 12px;
    bottom: 12px;
  }
  .agent-popover {
    width: calc(100vw - 24px);
    height: min(680px, calc(100vh - 92px));
  }
}
</style>
