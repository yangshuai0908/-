<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import AgentReply from "../components/AgentReply.vue";
import {
  streamAgentChat,
  type AgentAction,
  type AgentRole,
} from "../api/client";
import {
  createHistory,
  readHistory,
  serializeHistory,
  startNewSession,
  type Turn,
} from "../modules/agent/history";
import {
  activeTab,
  agentPendingRequest,
  agentWorkspaceContext,
  applyAgentAction,
  canvasFocus,
  clearCanvasFocus,
  currentProjectId,
  currentRequirement,
  currentRequirementId,
  openAgentArtifact,
  setCanvasFocus,
} from "../stores/workspace";
import { AGENT_ROLE_IDS, AGENT_ROLES, isHumanConfirmed } from "../types";

const message = useMessage();
const history = ref(createHistory());
const session = computed(
  () =>
    history.value.sessions.find((item) => item.id === history.value.activeId)!,
);
const draft = ref("");
const pending = ref(false);
const error = ref("");
const role = ref<AgentRole>("team");
const isInputFocused = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function autoResizeTextarea() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 160)}px`;
}

watch(draft, () => {
  nextTick(autoResizeTextarea);
});

const conversation = ref<HTMLElement | null>(null);
let controller: AbortController | null = null;
let disposed = false;
const key = (id: string) => `tp_agent_turns_${id}`;
const contextLabel = computed(
  () => currentRequirement.value?.label || "选择或导入需求后开始",
);

interface ActionChip {
  icon: string;
  label: string;
  prompt: string;
  role?: AgentRole;
}

const suggestions = computed<ActionChip[]>(() => {
  const requirement = currentRequirement.value;
  if (!requirement) {
    return [
      {
        icon: "📋",
        label: "项目概览",
        prompt: "概览当前项目的需求版本与测试覆盖情况",
        role: "team",
      },
    ];
  }
  if (!requirement.analysis) {
    return [
      {
        icon: "🧠",
        label: "分析需求并提炼测试点",
        prompt: "深入分析当前需求文档，自动拆解测试点与待确认问题",
        role: "analyst",
      },
      {
        icon: "🛣️",
        label: "梳理业务主路径",
        prompt: "梳理当前需求的主干业务路径与状态流转拓扑",
        role: "analyst",
      },
    ];
  }

  const confirmed = requirement.analysis.sections
    .flatMap((section) => section.points)
    .filter(isHumanConfirmed);
  return confirmed.length
    ? [
        {
          icon: "⚡",
          label: "按已确认测试点生成用例",
          prompt: "按已确认测试点生成测试用例",
          role: "qa_expert",
        },
        {
          icon: "📊",
          label: "检查用例覆盖与质量",
          prompt: "检查已有测试用例对条款的覆盖情况，识别盲区",
          role: "reviewer",
        },
      ]
    : [
        {
          icon: "📋",
          label: "核对待确认测试点",
          prompt: "解释需求中的待澄清问题，协助我人工核对测试点",
          role: "analyst",
        },
        {
          icon: "🛡️",
          label: "排查需求风险",
          prompt: "走查需求中的规则矛盾、时序与并发隐患等深层风险",
          role: "analyst",
        },
      ];
});

const contextualChips = computed<ActionChip[]>(() => {
  const focus = canvasFocus.value;
  if (focus) {
    if (focus.type === "chunk") {
      return [];
    }
    if (focus.type === "point") {
      return [{ icon: AGENT_ROLES.analyst.icon, label: '核对测试点', prompt: '请核对当前选中测试点的原文依据、验证条件和待澄清问题，只给出建议，不生成用例或代替人工确认。', role: 'analyst' }];
    }
    if (focus.type === "case") {
      return [
        { icon: AGENT_ROLES.reviewer.icon, label: '检查用例', prompt: '检查当前选中用例的原文依据、步骤和预期，只给出问题与修改建议，不修改用例。', role: 'reviewer' },
        { icon: AGENT_ROLES.qa_expert.icon, label: '优化用例', prompt: '基于需求原文优化当前选中用例的步骤和预期，使用 update_case 保存；保持验证目标，缺失规则先澄清，不新增用例。', role: 'qa_expert' },
      ];
    }
  }
  return suggestions.value;
});

function executeSuggestedTask(chip: ActionChip) {
  if (chip.role) role.value = chip.role;
  void send(chip.prompt);
}

function focusTypeLabel(type: string): string {
  if (type === "chunk") return "条款";
  if (type === "point") return "测试点";
  if (type === "case") return "用例";
  return "对象";
}

function persist(projectId = currentProjectId.value, value = history.value) {
  if (!projectId) return;
  try {
    localStorage.setItem(key(projectId), serializeHistory(value));
  } catch {
    error.value = "对话未能保存到浏览器，请暂时不要刷新页面";
  }
}
function scroll() {
  nextTick(() => {
    if (conversation.value)
      conversation.value.scrollTop = conversation.value.scrollHeight;
  });
}
function stop() {
  controller?.abort();
}
watch(
  currentProjectId,
  (id, oldId) => {
    if (oldId) {
      persist(oldId);
      stop();
    }
    try {
      history.value = readHistory(id ? localStorage.getItem(key(id)) : null);
    } catch {
      history.value = createHistory();
      message.error("对话历史读取失败，原始本地记录未覆盖");
    }
    draft.value = "";
    error.value = "";
    scroll();
  },
  { immediate: true },
);
function newChat() {
  if (pending.value) return;
  history.value = startNewSession(history.value);
  draft.value = "";
  error.value = "";
  persist();
}
function switchSession(id: string) {
  if (pending.value) return;
  history.value.activeId = id;
  error.value = "";
  persist();
  scroll();
}
watch(agentPendingRequest, (request) => {
  if (!request) return;
  if (request.focus) setCanvasFocus(request.focus);
  if (request.role) role.value = request.role;
  draft.value = request.prompt;
  agentPendingRequest.value = null;
  if (request.autoSend && !pending.value) void send();
});
function handleKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}
async function send(text = draft.value) {
  const content = text.trim(),
    projectId = currentProjectId.value,
    requirementId = currentRequirementId.value;
  if (!content || !projectId || pending.value) return;
  const requestHistory = history.value,
    requestSession = session.value,
    workspace = agentWorkspaceContext();
  let automaticView = activeTab.value,
    processedActions = 0;
  requestSession.turns.push({ role: "user", content });
  const messages = requestSession.turns
    .filter((turn) => turn.content.trim())
    .slice(-20)
    .map(({ role, content }) => ({ role, content: content.slice(0, 2500) }));
  const assistant = reactive<Turn>({
    role: "assistant",
    content: "",
    actions: [],
    streaming: true,
    status: "正在读取需求与选中对象…",
    roleType: role.value,
  });
  requestSession.turns.push(assistant);
  draft.value = "";
  pending.value = true;
  error.value = "";
  persist(projectId, requestHistory);
  scroll();
  const requestController = new AbortController();
  controller = requestController;
  const scopeMatches = () =>
    !disposed &&
    currentProjectId.value === projectId &&
    currentRequirementId.value === requirementId;
  function actionCompleted(action: AgentAction) {
    assistant.actions!.push(action);
    processedActions++;
    if (!scopeMatches()) return;
    applyAgentAction(action);
    if (activeTab.value === automaticView) {
      openAgentArtifact(action);
      automaticView = activeTab.value;
    }
  }
  try {
    await streamAgentChat(
      { projectId, requirementId, workspace, role: role.value, messages },
      (event) => {
        if (event.type === "status")
          assistant.status = event.message || "正在执行…";
        if (event.type === "delta") {
          assistant.content += event.delta || "";
          assistant.status = "";
        }
        if (event.type === "action" && event.action)
          actionCompleted(event.action);
        if (event.type === "done") {
          if (event.message !== undefined) assistant.content = event.message;
          for (const action of (event.actions || []).slice(processedActions))
            actionCompleted(action);
          assistant.status = "";
        }
        if (event.type === "error") throw new Error(event.error || "执行失败");
        scroll();
      },
      requestController.signal,
    );
  } catch (e) {
    if ((e as Error).name !== "AbortError" && scopeMatches())
      error.value = (e as Error).message;
  } finally {
    assistant.streaming = false;
    assistant.status = requestController.signal.aborted
      ? "已停止接收回复；已保存的成果可在右侧核对"
      : "";
    pending.value = false;
    if (controller === requestController) controller = null;
    persist(projectId, requestHistory);
    scroll();
  }
}
onBeforeUnmount(() => {
  disposed = true;
  stop();
});
</script>

<template>
  <section class="agent-workspace" aria-label="测试设计 Agent">
    <header class="agent-header">
      <div class="header-left">
        <h1>测试用例助手</h1>
      </div>
      <button
        class="new-chat-btn"
        :disabled="pending || !currentProjectId"
        @click="newChat"
      >
        + 新对话
      </button>
    </header>

    <div class="context">
      <div class="context-req">
        <span class="context-icon">📄</span>
        <span class="context-text" :title="contextLabel">{{
          contextLabel
        }}</span>
      </div>
      <select
        v-if="currentProjectId"
        aria-label="对话记录"
        class="session-select"
        :value="history.activeId"
        :disabled="pending"
        @change="switchSession(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="item in history.sessions"
          :key="item.id"
          :value="item.id"
        >
          {{
            item.turns
              .find((turn) => turn.role === "user")
              ?.content.slice(0, 24) || "新对话"
          }}
        </option>
      </select>
    </div>

    <div ref="conversation" class="conversation" aria-live="polite">
      <div v-if="!session.turns.length" class="welcome">
        <div class="welcome-icon">✨</div>
        <h2>现在可以继续这项工作</h2>
        <p>点选推荐任务即可执行。需要调整范围或说明细节时，再在下方输入。</p>
        <div class="welcome-chips">
          <button
            v-for="item in suggestions"
            :key="item.label"
            class="welcome-chip"
            :disabled="!currentProjectId"
            @click="executeSuggestedTask(item)"
          >
            <span>{{ item.icon }} {{ item.label }}</span>
            <span class="chip-arrow">↗</span>
          </button>
        </div>
      </div>

      <article
        v-for="(turn, index) in session.turns"
        :key="index"
        class="turn"
        :class="turn.role"
      >
        <div class="turn-meta">
          <template v-if="turn.role === 'user'">
            <span class="turn-label">我</span>
            <div class="turn-avatar user-avatar" title="当前操作者">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor">
                <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
              </svg>
            </div>
          </template>
          <template v-else>
            <div class="turn-avatar assistant-avatar" title="TestPilot 智能助手">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor">
                <path d="M10 2a1 1 0 011 1v1.07A7.002 7.002 0 0117 11v3a3 3 0 01-3 3H6a3 3 0 01-3-3v-3a7.002 7.002 0 016-6.93V3a1 1 0 011-1zm-3 9a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
              </svg>
            </div>
            <span class="turn-label">TestPilot Copilot</span>
            <span
              v-if="turn.roleType"
              class="role-tag"
              :title="`工作角色：${AGENT_ROLES[turn.roleType]?.label || turn.roleType}`"
            >
              <span class="role-tag-icon">{{ AGENT_ROLES[turn.roleType]?.icon || '🤖' }}</span>
              <span>{{ AGENT_ROLES[turn.roleType]?.label || turn.roleType }}</span>
            </span>
          </template>
        </div>

        <div v-if="turn.role === 'user'" class="user-content">
          {{ turn.content }}
        </div>

        <div v-else class="assistant-content">
          <AgentReply v-if="turn.content" :content="turn.content" />

          <div
            v-if="turn.status"
            class="status-indicator"
            :class="{ aborted: !turn.streaming }"
          >
            <span v-if="turn.streaming" class="status-spinner" />
            <span v-else class="status-icon">⏹</span>
            <span>{{ turn.status }}</span>
          </div>

          <div
            v-for="(action, actionIndex) in turn.actions"
            :key="actionIndex"
            class="action-result"
            :class="{ failed: action.error }"
          >
            <div class="action-header">
              <span class="action-tag">{{
                action.error ? "执行异常" : "工具调用"
              }}</span>
              <strong class="action-title">{{ action.title }}</strong>
            </div>
            <button
              v-if="action.artifact && !action.error"
              class="action-open-btn"
              @click="openAgentArtifact(action)"
            >
              {{ action.tool === 'scan_vulnerabilities' ? '核对并处理建议 ↗' : '打开对应成果 ↗' }}
            </button>
            <details v-if="action.data" class="action-details">
              <summary>查看执行返回数据</summary>
              <pre>{{ JSON.stringify(action.data, null, 2) }}</pre>
            </details>
          </div>
        </div>
      </article>
    </div>

    <footer class="composer">
      <!-- 动态上下文快捷指令胶囊 -->
      <div v-if="contextualChips.length" class="chips-container">
        <span class="chips-hint">针对当前选择 · 点击直接执行</span>
        <div class="chips-list">
          <button
            v-for="(chip, idx) in contextualChips"
            :key="idx"
            class="chip-capsule"
            :disabled="pending || !currentProjectId"
            @click="executeSuggestedTask(chip)"
          >
            <span class="chip-icon">{{ chip.icon }}</span>
            <span class="chip-label">{{ chip.label }}</span>
          </button>
        </div>
      </div>

      <p v-if="error" class="error-msg" role="alert">{{ error }}</p>

      <!-- ChatGPT 风格胶囊输入卡片 -->
      <div
        class="chatgpt-capsule"
        :class="{
          'is-focused': isInputFocused,
          'has-content': Boolean(draft.trim()),
          'is-disabled': !currentProjectId,
        }"
      >
        <!-- 画布焦点嵌入胶囊顶部 -->
        <div v-if="canvasFocus" class="capsule-focus-bar">
          <div class="focus-pill-meta">
            <span class="focus-type-badge">{{ focusTypeLabel(canvasFocus.type) }}</span>
            <span class="focus-pill-title" :title="canvasFocus.title">{{ canvasFocus.title }}</span>
          </div>
          <button
            class="focus-pill-close"
            aria-label="取消选中对象"
            title="取消对齐"
            @click="clearCanvasFocus"
          >
            ✕
          </button>
        </div>

        <!-- 文本输入区 -->
        <div class="capsule-input-row">
          <textarea
            ref="textareaRef"
            v-model="draft"
            rows="1"
            aria-label="给 Agent 的指令"
            :disabled="!currentProjectId"
            :placeholder="
              canvasFocus
                ? `针对${focusTypeLabel(canvasFocus.type)}「${canvasFocus.title}」向 Agent 提问或指派任务…`
                : '描述要完成的工作，Shift+Enter 换行…'
            "
            @focus="isInputFocused = true"
            @blur="isInputFocused = false"
            @input="autoResizeTextarea"
            @keydown="handleKey"
          />
        </div>

        <!-- 胶囊底栏：侧重模式胶囊 + ChatGPT 圆形发送/停止按钮 -->
        <div class="capsule-bottom-bar">
          <div class="role-capsule" :title="`当前角色：${AGENT_ROLES[role].label}（点击切换）`">
            <span class="role-icon">{{ AGENT_ROLES[role].icon }}</span>
            <span class="role-name">{{ AGENT_ROLES[role].label }}</span>
            <span class="role-chevron">▾</span>
            <select
              v-model="role"
              aria-label="工作角色"
              :disabled="pending"
              class="role-select"
            >
              <option v-for="id in AGENT_ROLE_IDS" :key="id" :value="id">{{ AGENT_ROLES[id].label }}</option>
            </select>
          </div>

          <div class="capsule-actions-right">
            <button
              v-if="pending"
              type="button"
              class="chatgpt-btn stop"
              title="停止回复"
              @click="stop"
            >
              <span class="stop-icon" />
            </button>
            <button
              v-else
              type="button"
              class="chatgpt-btn send"
              :class="{ ready: Boolean(draft.trim()) && Boolean(currentProjectId) }"
              :disabled="!currentProjectId || !draft.trim()"
              title="发送指令 (Enter)"
              @click="send()"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="composer-footer">
        <small>{{ AGENT_ROLES[role].description }}</small>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.agent-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #ffffff;
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 14px;
  border-bottom: 1px solid #f1f5f9;
}
h1 {
  font-size: 17px;
  margin: 2px 0 0;
  font-weight: 700;
  color: #0f172a;
}
.new-chat-btn {
  font-size: 12px;
  color: #3b82f6;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 5px 11px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.15s ease;
}
.new-chat-btn:hover:not(:disabled) {
  background: #dbeafe;
}
.new-chat-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 22px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 12px;
  gap: 12px;
  color: #64748b;
}
.context-req {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}
.context-text {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: #334155;
}
.session-select {
  max-width: 50%;
  font: inherit;
  font-size: 12px;
  color: #475569;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 4px 8px;
}

.conversation {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 22px;
}

.welcome {
  padding: 40px 10px;
  max-width: 480px;
  margin: auto;
  text-align: center;
}
.welcome-icon {
  width: 46px;
  height: 46px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  color: #2563eb;
  font-size: 20px;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.15);
}
.welcome h2 {
  font-size: 18px;
  color: #0f172a;
  margin: 0 0 8px;
  font-weight: 700;
}
.welcome p {
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 20px;
}
.welcome-chips {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.welcome-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}
.welcome-chip:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}
.chip-arrow {
  color: #94a3b8;
  font-size: 13px;
}

.turn {
  display: flex;
  flex-direction: column;
  margin-bottom: 24px;
  font-size: 13px;
  line-height: 1.7;
}

/* --- 用户消息（居右） --- */
.turn.user {
  align-items: flex-end;
  margin-left: auto;
  max-width: 88%;
}
.turn.user .turn-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-bottom: 6px;
}
.turn.user .turn-label {
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
}
.user-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #bfdbfe;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.user-content {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #ffffff;
  border-radius: 16px 3px 16px 16px;
  padding: 10px 14px;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 100%;
  width: fit-content;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.18);
  font-size: 13px;
  line-height: 1.6;
}
.user-content ::selection {
  background: rgba(255, 255, 255, 0.35);
  color: #ffffff;
}

/* --- 模型消息（居左） --- */
.turn.assistant {
  align-items: flex-start;
  margin-right: auto;
  width: 100%;
  max-width: 98%;
}
.turn.assistant .turn-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.assistant-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(37, 99, 235, 0.25);
  flex-shrink: 0;
}
.turn.assistant .turn-label {
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
}
.role-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  background: #eff6ff;
  color: #1e40af;
  border: 1px solid #bfdbfe;
  padding: 1px 8px;
  border-radius: 9999px;
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.04);
}
.role-tag-icon {
  font-size: 11px;
}

.assistant-content {
  width: 100%;
  padding-left: 2px;
}

/* 状态提示与停止提示 */
.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #2563eb;
  font-size: 12px;
  margin-top: 8px;
  padding: 5px 12px;
  background: #eff6ff;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  width: fit-content;
}
.status-indicator.aborted {
  background: #f8fafc;
  border-color: #e2e8f0;
  color: #64748b;
}
.status-icon {
  font-size: 11px;
  opacity: 0.8;
}
.status-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #bfdbfe;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.action-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-top: 10px;
  background: #f8fafc;
}
.action-result.failed {
  border-color: #fecaca;
  background: #fef2f2;
}
.action-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.action-tag {
  font-size: 10px;
  font-weight: 600;
  background: #e2e8f0;
  color: #475569;
  padding: 1px 5px;
  border-radius: 3px;
}
.action-result.failed .action-tag {
  background: #fee2e2;
  color: #b91c1c;
}
.action-title {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
}
.action-open-btn {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  margin-top: 2px;
}
.action-open-btn:hover {
  background: #dbeafe;
}
.action-details {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
}
.action-details pre {
  margin-top: 6px;
  padding: 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  max-height: 180px;
  overflow: auto;
  font-family: ui-monospace, monospace;
}

.composer {
  padding: 10px 18px 12px;
  border-top: 1px solid #f1f5f9;
  background: #ffffff;
  flex-shrink: 0;
}

/* 顶部上下文快捷指令 - ChatGPT 药丸胶囊 */
.chips-container {
  margin-bottom: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chips-hint {
  display: block;
  margin: 0 0 4px 2px;
  color: #94a3b8;
  font-size: 10px;
}
.chips-container::-webkit-scrollbar {
  display: none;
}
.chips-list {
  display: flex;
  align-items: center;
  gap: 6px;
  width: max-content;
  padding: 2px 0;
}
.chip-capsule {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  white-space: nowrap;
}
.chip-capsule:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.08);
}
.chip-capsule:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.chip-icon {
  font-size: 12px;
}

.error-msg {
  color: #dc2626;
  font-size: 12px;
  margin: 0 0 6px;
}

/* ChatGPT 风格输入胶囊卡片 */
.chatgpt-capsule {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 10px 14px 8px 14px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chatgpt-capsule.is-focused {
  background: #ffffff;
  border-color: #3b82f6;
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.12);
}
.chatgpt-capsule.is-disabled {
  opacity: 0.6;
  background: #f1f5f9;
}

/* 嵌入胶囊顶部的对齐焦点小栏 */
.capsule-focus-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #eff6ff;
  border: 1px solid #dbeafe;
  border-radius: 9999px;
  padding: 2px 8px 2px 6px;
  font-size: 11px;
}
.focus-pill-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
}
.focus-type-badge {
  font-size: 9px;
  font-weight: 700;
  background: #2563eb;
  color: #ffffff;
  padding: 1px 5px;
  border-radius: 9999px;
  flex-shrink: 0;
}
.focus-pill-title {
  color: #1e40af;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-pill-close {
  background: transparent;
  border: none;
  color: #93c5fd;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
}
.focus-pill-close:hover {
  color: #1e40af;
}

/* 输入框核心区 */
.capsule-input-row {
  width: 100%;
}
.capsule-input-row textarea {
  display: block;
  width: 100%;
  min-height: 24px;
  max-height: 160px;
  height: 24px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: #0f172a;
  padding: 0;
}
.capsule-input-row textarea::placeholder {
  color: #94a3b8;
}

/* 胶囊底栏 */
.capsule-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 2px;
}

/* 侧重模式胶囊 (ChatGPT 模式切换风格) */
.role-capsule {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 9999px;
  padding: 3px 9px;
  font-size: 11px;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}
.role-capsule:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #1e293b;
}
.role-icon {
  font-size: 11px;
}
.role-name {
  font-weight: 500;
  font-size: 11px;
}
.role-chevron {
  font-size: 10px;
  color: #94a3b8;
  margin-left: 1px;
}
.role-select {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
  height: 100%;
}

/* ChatGPT 圆形发送/停止按钮 */
.capsule-actions-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chatgpt-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: none;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  padding: 0;
}
.chatgpt-btn.send {
  background: #e2e8f0;
  color: #94a3b8;
}
.chatgpt-btn.send.ready {
  background: #0f172a;
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.25);
}
.chatgpt-btn.send.ready:hover {
  background: #2563eb;
  transform: scale(1.05);
}
.chatgpt-btn.send:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.chatgpt-btn.stop {
  background: #0f172a;
  color: #ffffff;
}
.chatgpt-btn.stop:hover {
  background: #ef4444;
}
.stop-icon {
  width: 9px;
  height: 9px;
  background: currentColor;
  border-radius: 2px;
}

.composer-footer {
  margin-top: 8px;
  text-align: center;
}
.composer-footer small {
  color: #94a3b8;
  font-size: 11px;
}
</style>
