<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NSpin } from "naive-ui";
import {
  api,
  streamAgentChat,
  type AgentAction,
  type AgentMessage,
} from "../api/client";
import {
  currentProject,
  currentProjectId,
  currentRequirement,
  currentRequirementId,
  requirements,
} from "../stores/workspace";

const props = withDefaults(defineProps<{ compact?: boolean }>(), {
  compact: false,
});

interface Turn extends AgentMessage {
  actions?: AgentAction[];
  status?: string;
  streaming?: boolean;
}

const turns = ref<Turn[]>([]);
const draft = ref("");
const pending = ref(false);
const error = ref("");
const isFocused = ref(false);
const isMultiline = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const conversation = ref<HTMLElement | null>(null);
let abortController: AbortController | null = null;

const suggestions = [
  "分析需求并拆出测试点",
  "评审现有测试用例",
  "生成四类测试用例",
];
const contextLabel = computed(() => {
  if (!currentProject.value) return "请先选择或新建项目";
  return currentRequirement.value
    ? `${currentProject.value.name} · ${currentRequirement.value.label}`
    : `${currentProject.value.name} · 尚未选择需求版本`;
});

let scrollRaf: number | null = null;
function scrollToBottom() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    if (conversation.value) {
      conversation.value.scrollTop = conversation.value.scrollHeight;
    }
  });
}

function getStorageKey(projectId: string) {
  return `tp_agent_turns_${projectId}`;
}

function loadTurnsFromStorage(projectId: string | null) {
  if (!projectId) {
    turns.value = [];
    return;
  }
  try {
    const raw = localStorage.getItem(getStorageKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        turns.value = parsed.map((t: Turn) => ({
          role: t.role,
          content: t.content || "",
          actions: t.actions || [],
          streaming: false,
          status: "",
        }));
        nextTick(() => scrollToBottom());
        return;
      }
    }
  } catch (e) {
    console.warn("Failed to load agent turns from localStorage:", e);
  }
  turns.value = [];
}

function saveTurnsToStorage(projectId: string | null) {
  if (!projectId) return;
  try {
    const toSave = turns.value
      .filter(
        (t) =>
          (t.content && t.content.trim().length > 0) ||
          (t.actions && t.actions.length > 0),
      )
      .slice(-50)
      .map(({ role, content, actions }) => ({
        role,
        content: content.trim(),
        actions: actions ? [...actions] : undefined,
      }));
    localStorage.setItem(getStorageKey(projectId), JSON.stringify(toSave));
  } catch (e) {
    console.warn("Failed to save agent turns to localStorage:", e);
  }
}

function clearMemory() {
  if (pending.value) {
    stop();
  }
  turns.value = [];
  error.value = "";
  if (currentProjectId.value) {
    try {
      localStorage.removeItem(getStorageKey(currentProjectId.value));
    } catch (e) {
      console.warn("Failed to clear agent history:", e);
    }
  }
}

function adjustTextareaHeight() {
  const el = textareaRef.value;
  if (!el) return;
  if (!draft.value) {
    el.style.height = "22px";
    el.style.overflowY = "hidden";
    isMultiline.value = false;
    return;
  }
  el.style.height = "auto";
  const maxHeight = 140;
  const scrollHeight = el.scrollHeight;
  if (scrollHeight > maxHeight) {
    el.style.height = `${maxHeight}px`;
    el.style.overflowY = "auto";
    isMultiline.value = true;
  } else {
    const targetHeight = Math.max(scrollHeight, 22);
    el.style.height = `${targetHeight}px`;
    el.style.overflowY = "hidden";
    isMultiline.value = targetHeight > 26 || draft.value.includes("\n");
  }
}

function resetTextareaHeight() {
  isMultiline.value = false;
  if (textareaRef.value) {
    textareaRef.value.style.height = "22px";
    textareaRef.value.style.overflowY = "hidden";
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!pending.value && currentProjectId.value && draft.value.trim()) {
      send();
    }
  }
}

function stop() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (currentProjectId.value) {
    saveTurnsToStorage(currentProjectId.value);
  }
}

watch(turns, () => scrollToBottom(), { deep: true });

watch(
  currentProjectId,
  (newId, oldId) => {
    if (oldId && newId !== oldId) {
      saveTurnsToStorage(oldId);
    }
    error.value = "";
    loadTurnsFromStorage(newId);
  },
  { immediate: true },
);

async function send(text = draft.value) {
  const content = text.trim();
  if (!content || pending.value || !currentProjectId.value) return;
  const projectId = currentProjectId.value;
  const requirementId = currentRequirementId.value;
  let analysisRefresh: Promise<void> | null = null;

  turns.value.push({ role: "user", content });
  draft.value = "";
  error.value = "";
  pending.value = true;
  resetTextareaHeight();
  saveTurnsToStorage(projectId);

  const assistantTurn = ref<Turn>({
    role: "assistant",
    content: "",
    actions: [],
    status: "正在分析任务…",
    streaming: true,
  });
  turns.value.push(assistantTurn.value);
  scrollToBottom();

  abortController = new AbortController();

  try {
    const messages = turns.value
      .filter((t) => t !== assistantTurn.value && t.content.trim().length > 0)
      .slice(-20)
      .map(({ role, content: message }) => ({
        role,
        content: message.slice(0, 2500),
      }));

    await streamAgentChat(
      {
        projectId,
        requirementId,
        messages,
      },
      (evt) => {
        if (evt.type === "status") {
          assistantTurn.value.status = evt.message || "正在分析任务…";
        } else if (evt.type === "action" && evt.action) {
          if (!assistantTurn.value.actions) assistantTurn.value.actions = [];
          assistantTurn.value.actions.push(evt.action);
        } else if (evt.type === "delta" && evt.delta) {
          assistantTurn.value.content += evt.delta;
          assistantTurn.value.status = "";
        } else if (evt.type === "done") {
          if (evt.message) assistantTurn.value.content = evt.message;
          if (evt.actions) assistantTurn.value.actions = evt.actions;
          if (
            !analysisRefresh &&
            assistantTurn.value.actions?.some(
              (action) => action.tool === "analyze_requirement",
            )
          ) {
            const stamps = new Map(
              requirements.value.map((requirement) => [
                requirement.id,
                `${requirement.analysis?.id ?? ""}:${requirement.analysis?.updatedAt ?? ""}`,
              ]),
            );
            analysisRefresh = api
              .listRequirements(projectId)
              .then((list) => {
                if (currentProjectId.value !== projectId) return;
                for (const incoming of list) {
                  const target = requirements.value.find(
                    (requirement) => requirement.id === incoming.id,
                  );
                  if (
                    target &&
                    stamps.get(target.id) ===
                      `${target.analysis?.id ?? ""}:${target.analysis?.updatedAt ?? ""}`
                  ) {
                    target.analysis = incoming.analysis;
                  }
                }
              })
              .catch((e: unknown) => {
                if (currentProjectId.value === projectId) {
                  error.value = `需求分析已完成，但同步失败，请到需求页刷新分析：${e instanceof Error ? e.message : "请求失败"}`;
                }
              });
          }
          assistantTurn.value.status = "";
          assistantTurn.value.streaming = false;
        } else if (evt.type === "error") {
          error.value = evt.error || "Agent 执行异常";
          assistantTurn.value.status = "";
          assistantTurn.value.streaming = false;
        }
        scrollToBottom();
      },
      abortController.signal,
    );
    await analysisRefresh;
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      error.value = (e as Error).message;
    }
  } finally {
    assistantTurn.value.streaming = false;
    assistantTurn.value.status = "";
    pending.value = false;
    abortController = null;
    saveTurnsToStorage(projectId);
    scrollToBottom();
  }
}
</script>

<template>
  <section class="page agent-page" :class="{ compact: props.compact }">
    <div v-if="!props.compact" class="agent-heading">
      <div>
        <div class="eyebrow">TESTPILOT AGENT</div>
        <h1>测试用例设计助手</h1>
        <p>
          从需求理解与测试点核对开始，再进行用例设计。Agent
          会读取项目数据并调用工具，需配置真实大模型。
        </p>
      </div>
      <div class="heading-actions">
        <button
          v-if="turns.length"
          type="button"
          class="new-chat-btn"
          title="开启新对话 / 清空当前记忆"
          @click="clearMemory"
        >
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 4v16m8-8H4" />
          </svg>
          开启新对话
        </button>
        <div class="context-chip">
          <span class="context-dot" />{{ contextLabel }}
        </div>
      </div>
    </div>
    <div v-else class="compact-context">
      <span class="compact-label" :title="contextLabel">{{ contextLabel }}</span>
      <button
        v-if="turns.length"
        type="button"
        class="compact-new-chat-btn"
        title="开启新对话 / 清空当前记忆"
        @click="clearMemory"
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 4v16m8-8H4" />
        </svg>
        <span>新对话</span>
      </button>
    </div>

    <div class="agent-card">
      <div v-if="!turns.length" class="welcome">
        <div class="welcome-mark">TP</div>
        <h2>先一起核对需求与测试范围</h2>
        <p>
          我可以分析需求、拆出测试点与待确认问题，再协助生成用例、比较版本和评审。需求分析不会修改已有用例。
        </p>
        <div class="suggestions">
          <button
            v-for="item in suggestions"
            :key="item"
            type="button"
            :disabled="!currentProjectId || pending"
            @click="send(item)"
          >
            {{ item }} <span>→</span>
          </button>
        </div>
      </div>

      <div v-else ref="conversation" class="conversation">
        <article
          v-for="(turn, index) in turns"
          :key="index"
          class="turn"
          :class="turn.role"
        >
          <div class="turn-label">
            {{ turn.role === "user" ? "你" : "TestPilot Agent" }}
          </div>

          <div v-if="turn.actions?.length" class="actions">
            <div
              v-for="(action, i) in turn.actions"
              :key="`${action.tool}-${i}`"
              class="action-row"
            >
              <span class="action-check">✓</span>
              <span>{{ action.title }}</span>
            </div>
          </div>

          <div v-if="turn.content" class="bubble">
            {{ turn.content
            }}<span v-if="turn.streaming" class="stream-cursor">▌</span>
          </div>

          <div v-if="turn.status && turn.streaming" class="bubble thinking">
            <n-spin size="small" /> <span>{{ turn.status }}</span>
          </div>
        </article>
      </div>

      <div class="composer-wrap">
        <div v-if="error" class="error-note">{{ error }}</div>

        <!-- ChatGPT 风格胶囊输入框：初始胶囊药丸状、随内容自增高、支持打断与发送 -->
        <div
          class="chatgpt-capsule"
          :class="{
            focused: isFocused,
            multiline: isMultiline,
            disabled: !currentProjectId,
          }"
        >
          <textarea
            ref="textareaRef"
            v-model="draft"
            class="capsule-textarea"
            :placeholder="
              props.compact
                ? '输入指令或提问（Enter 发送）…'
                : '给设计助手发送指令（例如：分析需求并拆出测试点）'
            "
            :disabled="!currentProjectId"
            rows="1"
            @input="adjustTextareaHeight"
            @keydown="handleKeydown"
            @focus="isFocused = true"
            @blur="isFocused = false"
          />

          <div class="capsule-actions">
            <!-- 正在生成中：显示 ChatGPT 黑色方形打断/停止按钮 -->
            <button
              v-if="pending"
              type="button"
              class="action-btn stop-btn"
              title="停止生成 (打断)"
              @click="stop()"
            >
              <span class="stop-icon" />
            </button>

            <!-- 待命中：显示向上箭头发送按钮 -->
            <button
              v-else
              type="button"
              class="action-btn send-btn"
              :class="{
                active: Boolean(draft.trim()) && Boolean(currentProjectId),
              }"
              :disabled="!currentProjectId || !draft.trim()"
              title="发送消息"
              @click="send()"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>

        <div class="composer-footer">
          <span
            >需求分析不修改已有用例；测试点确认仅表示人工认可目标，待确认问题仍需核对。</span
          >
          <span class="shortcut-tip">Enter 发送，Shift + Enter 换行</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-page {
  max-width: 1180px;
  margin: 0 auto;
}
.agent-page.compact {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
}
.compact-context {
  flex: 0 0 auto;
  padding: 6px 12px;
  border-bottom: 1px solid #edf0f3;
  color: #87929d;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  box-sizing: border-box;
}
.compact-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.compact-new-chat-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #ffffff;
  border: 1px solid #dcdfe4;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 11px;
  color: #556270;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  line-height: 1.4;
  flex-shrink: 0;
}
.compact-new-chat-btn:hover {
  background: #f1f4f8;
  color: #1f364d;
  border-color: #bcc6d2;
}
.agent-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  margin-bottom: 18px;
}
.heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.new-chat-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #ffffff;
  border: 1px solid #d3d8df;
  border-radius: 5px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #435160;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.new-chat-btn:hover {
  background: #f4f6f8;
  color: #1f364d;
  border-color: #b5c0cc;
}
.eyebrow {
  color: #758394;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
h1 {
  margin: 7px 0 5px;
  color: #263442;
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.03em;
}
.agent-heading p {
  margin: 0;
  color: #7b8794;
  font-size: 13px;
}
.context-chip {
  max-width: 42%;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  padding: 8px 11px;
  border: 1px solid var(--tp-border);
  border-radius: 5px;
  background: #fff;
  color: #657383;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #4d8b6c;
}
.agent-card {
  min-height: min(640px, calc(100vh - 210px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--tp-border);
  border-radius: 6px;
  background: #fff;
}
.compact .agent-card {
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
}
.welcome {
  width: min(560px, 100%);
  margin: auto;
  padding: 52px 24px;
  text-align: center;
}
.welcome-mark {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  margin: 0 auto 18px;
  border-radius: 7px;
  background: #243b53;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
.welcome h2 {
  margin: 0 0 9px;
  color: #2c3947;
  font-size: 19px;
  font-weight: 620;
}
.welcome p {
  margin: 0 auto;
  color: #7b8794;
  font-size: 13px;
  line-height: 1.7;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
}
.suggestions button {
  border: 1px solid #e2e6eb;
  border-radius: 5px;
  padding: 9px 11px;
  background: #fff;
  color: #566575;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.suggestions button:hover:not(:disabled) {
  border-color: #bac8d5;
  background: #f8fafb;
  color: #304d69;
}
.suggestions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.suggestions span {
  margin-left: 5px;
  color: #8995a1;
}
.conversation {
  flex: 1;
  overflow: auto;
  padding: 28px clamp(16px, 6vw, 72px);
}
.turn {
  max-width: 760px;
  margin: 0 auto 22px;
}
.turn.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.turn-label {
  margin-bottom: 6px;
  color: #84909c;
  font-size: 11px;
}
.bubble {
  max-width: 100%;
  white-space: pre-wrap;
  color: #344252;
  font-size: 13px;
  line-height: 1.75;
}
.user .bubble {
  max-width: 78%;
  padding: 10px 13px;
  border-radius: 6px;
  background: #edf2f6;
}
.thinking {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #758394;
}
.actions {
  display: grid;
  gap: 5px;
  margin-top: 10px;
  margin-bottom: 8px;
}
.action-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #738091;
  font-size: 11px;
}
.action-check {
  color: #4d8b6c;
  font-weight: 700;
}
.stream-cursor {
  display: inline-block;
  margin-left: 2px;
  color: #3b82f6;
  font-weight: 700;
  animation: stream-blink 0.8s infinite;
}
@keyframes stream-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* ── ChatGPT 胶囊输入区 ── */
.composer-wrap {
  padding: 12px 16px 10px;
  border-top: 1px solid #edf0f3;
  background: #ffffff;
}
.error-note {
  margin: 0 0 6px;
  color: #b85858;
  font-size: 11.5px;
}

.chatgpt-capsule {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 8px 6px 15px;
  background: #f8fafc;
  border: 1px solid #dce2e8;
  border-radius: 22px; /* 精致圆润的胶囊药丸 */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.chatgpt-capsule.multiline {
  border-radius: 16px; /* 多行文本平滑微圆角 */
}

.chatgpt-capsule.focused {
  background: #ffffff;
  border-color: #243b53;
  box-shadow:
    0 0 0 1px #243b53,
    0 3px 12px rgba(36, 59, 83, 0.08);
}

.chatgpt-capsule.disabled {
  background: #f1f4f7;
  border-color: #e2e7ec;
  cursor: not-allowed;
}

.capsule-textarea {
  box-sizing: border-box;
  flex: 1;
  min-height: 22px;
  max-height: 140px;
  height: 22px;
  padding: 0;
  margin: 0;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 22px;
  color: #1e293b;
  overflow: hidden; /* 默认隐藏滚动条，只有文本超出 maxHeight 时才动态显示 */
  scrollbar-width: thin;
}

.capsule-textarea::-webkit-scrollbar {
  width: 4px;
}
.capsule-textarea::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 2px;
}

.capsule-textarea::placeholder {
  color: #94a3b8;
  font-size: 13px;
}

.capsule-textarea:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.capsule-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  outline: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

/* 发送按钮（禁用与激活态） */
.send-btn {
  background: #e2e8f0;
  color: #94a3b8;
}

.send-btn.active {
  background: #243b53;
  color: #ffffff;
}

.send-btn.active:hover {
  background: #17283c;
  transform: scale(1.05);
}

.send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

/* 打断 / 停止生成按钮（ChatGPT 风格黑色圆钮 + 白色方形） */
.stop-btn {
  background: #0f172a;
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
  animation: pulse-stop 2s infinite;
}

.stop-btn:hover {
  background: #000000;
  transform: scale(1.06);
}

.stop-icon {
  display: block;
  width: 9px;
  height: 9px;
  background: #ffffff;
  border-radius: 1.5px;
}

@keyframes pulse-stop {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(15, 23, 42, 0.3);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(15, 23, 42, 0);
  }
}

.composer-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  color: #94a3b8;
  font-size: 11px;
}

.shortcut-tip {
  color: #94a3b8;
  font-size: 10.5px;
}

@media (max-width: 620px) {
  .agent-heading {
    flex-direction: column;
    align-items: flex-start;
  }
  .context-chip {
    max-width: 100%;
  }
  .agent-card {
    min-height: calc(100vh - 278px);
  }
  .welcome {
    padding: 36px 16px;
  }
  .composer-wrap {
    padding: 10px 12px;
  }
  .chatgpt-capsule {
    padding: 6px 8px 6px 14px;
    border-radius: 20px;
  }
  .composer-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}
.compact .conversation {
  min-height: 0;
  padding: 16px 14px;
}
.compact .composer-wrap {
  padding: 10px 14px 8px;
}
.compact .composer-footer {
  justify-content: center;
  text-align: center;
  margin-top: 5px;
}
.compact .composer-footer .shortcut-tip {
  display: none;
}
.compact .composer-footer span {
  font-size: 10.5px;
}
.compact .welcome {
  padding: 24px 16px 16px;
}
.compact .welcome-mark {
  width: 34px;
  height: 34px;
  margin: 0 auto 10px;
  font-size: 11px;
}
.compact .welcome h2 {
  font-size: 16px;
  margin-bottom: 6px;
}
.compact .welcome p {
  font-size: 12px;
  line-height: 1.5;
  color: #8792a0;
}
.compact .suggestions {
  margin-top: 14px;
  gap: 6px;
}
.compact .suggestions button {
  padding: 6px 10px;
  font-size: 11.5px;
}
.compact .user .bubble {
  max-width: 92%;
}
</style>
