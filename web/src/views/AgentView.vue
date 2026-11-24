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
        label: "项目全貌概览",
        prompt: "概览当前项目的需求版本与测试覆盖情况",
      },
    ];
  }
  return [
    {
      icon: "🛡️",
      label: "排查深层隐患与规则矛盾",
      prompt: "全面走查当前需求中的规则矛盾、时序与并发隐患等深层风险，产出待核对建议",
    },
    {
      icon: "📊",
      label: "核对条款引用与质量覆盖",
      prompt: "检查已有测试用例对条款的覆盖情况，识别盲区并执行质量审查",
    },
    {
      icon: "📋",
      label: "梳理待核对测试点与疑问",
      prompt: "整理需求中的待澄清问题，协助我人工核对候选测试点",
    },
    {
      icon: "⚡",
      label: "按已确认测试点生成用例",
      prompt: "按已确认测试点生成测试用例",
    },
  ];
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

const TOOL_INFO: Record<string, { label: string; icon: string }> = {
  project_overview: { label: "项目概况", icon: "📋" },
  read_requirement: { label: "读取条款", icon: "📖" },
  analyze_requirement: { label: "需求分析", icon: "🧭" },
  search_cases: { label: "检索用例", icon: "🔍" },
  check_coverage: { label: "核算覆盖率", icon: "📊" },
  compare_versions: { label: "版本对比", icon: "🔄" },
  generate_cases: { label: "生成用例", icon: "⚡" },
  review_cases: { label: "质量评审", icon: "🛡️" },
  update_case: { label: "更新用例", icon: "✏️" },
  add_case: { label: "新增用例", icon: "➕" },
  batch_confirm_points: { label: "批量确认", icon: "✓" },
  scan_vulnerabilities: { label: "风险走查", icon: "🛡️" },
  analyze_pathways: { label: "路径分析", icon: "🗺️" },
};

function toolMeta(tool: string) {
  return TOOL_INFO[tool] || { label: tool, icon: "⚙️" };
}

function formatArgs(args?: Record<string, any>): string {
  if (!args || !Object.keys(args).length) return "";
  return Object.entries(args)
    .filter(([_, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

function summarizeResult(action: AgentAction): string {
  if (action.error) return action.error;
  const d = action.data;
  if (!d) return "";
  if (action.tool === "search_cases") {
    return Array.isArray(d.cases) ? `已检索到 ${d.cases.length} 条用例` : "";
  }
  if (action.tool === "check_coverage") {
    return `引用覆盖率 ${Math.round((d.rate || 0) * 100)}% · 缺口 ${d.uncoveredCount ?? (d.uncovered?.length || 0)} 条`;
  }
  if (action.tool === "review_cases") {
    return `评分 ${d.scores?.total ?? 0}/5 · 缺口 ${d.gaps?.length || 0} 处 · 疑似重复 ${d.duplicates?.length || 0} 组`;
  }
  if (action.tool === "scan_vulnerabilities") {
    return `排查出 ${d.issues?.length || 0} 项潜在风险与盲区建议`;
  }
  if (action.tool === "compare_versions") {
    return `变更条款 ${d.stats?.modified ?? 0} 处 · 建议新增用例 ${d.results?.newCases?.length || 0} 条`;
  }
  if (action.tool === "read_requirement") {
    return `已读取条款 ${d.reqId || ""} (${d.sectionPath || ""})`;
  }
  if (action.tool === "update_case") {
    return `用例【${d.title || d.id}】已按依据更新保存`;
  }
  if (action.tool === "add_case") {
    return `用例【${d.title || d.id}】已保存`;
  }
  return "";
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
  <section class="agent-workspace" aria-label="测试用例 Copilot">
    <header class="agent-header">
      <div class="header-brand">
        <span class="brand-dot" />
        <span class="brand-title">测试 Copilot</span>
        <span v-if="session.turns.length" class="turn-count-tag">
          {{ session.turns.filter((turn) => turn.role === "user").length }} 轮对话
        </span>
      </div>
      <button
        class="new-chat-btn"
        :disabled="pending || !currentProjectId"
        title="清空对话，开启新任务"
        @click="newChat"
      >
        + 新对话
      </button>
    </header>

    <div ref="conversation" class="conversation" aria-live="polite">
      <div v-if="!session.turns.length" class="welcome">
        <div class="welcome-icon">✨</div>
        <h2>TestPilot 智能协作</h2>
        <p>支持深度风险排查、盲区质检、用例优化与自由问答。点选推荐任务或在下方直接指派。</p>
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
          </template>
          <template v-else>
            <div class="turn-avatar assistant-avatar" title="TestPilot 智能助手">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor">
                <path d="M10 2a1 1 0 011 1v1.07A7.002 7.002 0 0117 11v3a3 3 0 01-3 3H6a3 3 0 01-3-3v-3a7.002 7.002 0 016-6.93V3a1 1 0 011-1zm-3 9a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
              </svg>
            </div>
            <span class="turn-label">TestPilot Copilot</span>
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
            <span class="status-text">{{ turn.status }}</span>
            <span v-if="turn.streaming && turn.actions?.length" class="status-step-badge">
              第 {{ turn.actions.length + 1 }} 步
            </span>
          </div>

          <div
            v-for="(action, actionIndex) in turn.actions"
            :key="actionIndex"
            class="action-result"
            :class="{ failed: action.error }"
          >
            <div class="action-header">
              <span class="action-tag">
                <span class="action-icon">{{ toolMeta(action.tool).icon }}</span>
                {{ action.error ? "执行异常" : toolMeta(action.tool).label }}
              </span>
              <strong class="action-title">{{ action.title }}</strong>
              <button
                v-if="action.artifact && !action.error"
                class="action-open-btn"
                @click="openAgentArtifact(action)"
              >
                {{ action.tool === 'scan_vulnerabilities' ? '核对建议 ↗' : '打开成果 ↗' }}
              </button>
            </div>

            <!-- 可折叠的工具入参与执行结果细节 -->
            <details v-if="action.args || summarizeResult(action)" class="action-details-panel">
              <summary class="details-summary">
                <span class="summary-toggle-icon">▸</span>
                <span class="summary-title">参数与细节</span>
                <span v-if="action.args && Object.keys(action.args).length" class="summary-args-badge" :title="formatArgs(action.args)">
                  {{ formatArgs(action.args) }}
                </span>
              </summary>
              <div class="details-body">
                <div v-if="action.args && Object.keys(action.args).length" class="detail-row">
                  <span class="detail-label">传入参数</span>
                  <pre class="detail-code">{{ JSON.stringify(action.args, null, 2) }}</pre>
                </div>
                <div v-if="summarizeResult(action)" class="detail-row">
                  <span class="detail-label">执行结论</span>
                  <span class="detail-value">{{ summarizeResult(action) }}</span>
                </div>
              </div>
            </details>
          </div>
        </div>
      </article>
    </div>

    <footer class="composer">
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

        <!-- 胶囊底栏：提示 + 发送/停止按钮 -->
        <div class="capsule-bottom-bar">
          <span class="capsule-hint">Enter 发送 · Shift+Enter 换行</span>

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
  padding: 12px 18px;
  border-bottom: 1px solid #f1f5f9;
  background: #ffffff;
  flex-shrink: 0;
}
.header-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 2px #d1fae5;
}
.brand-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.turn-count-tag {
  font-size: 11px;
  color: #64748b;
  background: #f1f5f9;
  border-radius: 9999px;
  padding: 1px 7px;
  font-weight: 500;
}
.new-chat-btn {
  font-size: 11px;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #dbeafe;
  border-radius: 6px;
  padding: 4px 9px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.15s ease;
}
.new-chat-btn:hover:not(:disabled) {
  background: #dbeafe;
  border-color: #bfdbfe;
}
.new-chat-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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
  max-width: 90%;
}
.turn.user .turn-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-bottom: 4px;
}
.turn.user .turn-label {
  color: #64748b;
  font-size: 11px;
  font-weight: 500;
}
.user-content {
  background: #f1f5f9;
  color: #0f172a;
  border: 1px solid #e2e8f0;
  border-radius: 12px 2px 12px 12px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 100%;
  width: fit-content;
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
  flex-wrap: wrap;
}
.action-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  background: #e2e8f0;
  color: #475569;
  padding: 2px 6px;
  border-radius: 4px;
}
.action-icon {
  font-size: 11px;
}
.action-result.failed .action-tag {
  background: #fee2e2;
  color: #b91c1c;
}
.action-title {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
  flex: 1;
  min-width: 120px;
}
.action-open-btn {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.action-open-btn:hover {
  background: #dbeafe;
}

/* 细节折叠面板 */
.action-details-panel {
  margin-top: 4px;
  border-top: 1px dashed #e2e8f0;
  padding-top: 6px;
}
.details-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 11px;
  color: #64748b;
  user-select: none;
  list-style: none;
}
.details-summary::-webkit-details-marker {
  display: none;
}
.summary-toggle-icon {
  font-size: 10px;
  display: inline-block;
  transition: transform 0.2s ease;
  color: #94a3b8;
}
.action-details-panel[open] .summary-toggle-icon {
  transform: rotate(90deg);
}
.summary-title {
  font-weight: 500;
  color: #475569;
}
.summary-args-badge {
  font-size: 10px;
  color: #64748b;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 3px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.details-body {
  margin-top: 6px;
  padding: 8px 10px;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 11px;
  display: grid;
  gap: 6px;
}
.detail-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.detail-label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.detail-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  padding: 6px 8px;
  border-radius: 4px;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 140px;
  overflow-y: auto;
  margin: 0;
}
.detail-value {
  color: #1e293b;
  line-height: 1.5;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  padding: 5px 8px;
  border-radius: 4px;
}
.status-step-badge {
  background: #dbeafe;
  color: #1e40af;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
  margin-left: 4px;
}

.composer {
  padding: 10px 18px 12px;
  border-top: 1px solid #f1f5f9;
  background: #ffffff;
  flex-shrink: 0;
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
  padding-top: 4px;
}
.capsule-hint {
  font-size: 11px;
  color: #94a3b8;
  user-select: none;
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
</style>
