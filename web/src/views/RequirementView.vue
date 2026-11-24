<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NInput,
  NInputGroup,
  NScrollbar,
  NSpin,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { api } from "../api/client";
import {
  activeTab,
  canvasFocus,
  clearCanvasFocus,
  currentProject,
  currentProjectId,
  currentRequirement,
  currentRequirementId,
  requirements,
  openRiskScan,
  setCanvasFocus,
} from "../stores/workspace";
import type { Chunk, RequirementVersion } from "../types";

const emit = defineEmits<{ refresh: [] }>();
const message = useMessage();
const dialog = useDialog();

const rawText = ref("");
const label = ref("");
const saving = ref(false);
const previewing = ref(false);
const previewChunks = ref<Chunk[]>([]);
const previewApis = ref<string[]>([]);
const hasPreview = ref(false);

const fileName = ref("");
const fileBase64 = ref("");
const fileSize = ref(0);

/** 控制录入/更新面板的折叠展开 */
const showInputPanel = ref(false);

/** 搜索关键词与选中的接口过滤 */
const searchKeyword = ref("");
const selectedApi = ref<string | null>(null);

/** 有附件时按文件内容入库，否则按文本框内容入库 */
const hasFile = computed(() => Boolean(fileName.value && fileBase64.value));
const isDocx = computed(() => fileName.value.toLowerCase().endsWith(".docx"));

function clearFile() {
  fileName.value = "";
  fileBase64.value = "";
  fileSize.value = 0;
  clearPreview();
}

/** 手动编辑文本框后以文本框为准，避免附件静默覆盖正在编辑的内容 */
function onTextInput() {
  if (hasFile.value) clearFile();
}

const activeRequirement = computed(() => {
  return currentRequirement.value?.projectId === currentProjectId.value
    ? currentRequirement.value
    : null;
});

/** 预览优先，其次显示当前选中版本的条款 */
const displayChunks = computed<Chunk[]>(() =>
  hasPreview.value
    ? previewChunks.value
    : (activeRequirement.value?.chunks ?? []),
);

const displayApis = computed<string[]>(() =>
  hasPreview.value
    ? previewApis.value
    : (activeRequirement.value?.apiList ?? []),
);

const filteredChunks = computed(() => {
  let list = displayChunks.value;
  if (selectedApi.value) {
    const apiLower = selectedApi.value.toLowerCase();
    list = list.filter(
      (c) =>
        c.text.toLowerCase().includes(apiLower) ||
        (c.sectionPath && c.sectionPath.toLowerCase().includes(apiLower)),
    );
  }
  const kw = searchKeyword.value.trim().toLowerCase();
  if (kw) {
    list = list.filter(
      (c) =>
        c.reqId.toLowerCase().includes(kw) ||
        c.text.toLowerCase().includes(kw) ||
        (c.sectionPath && c.sectionPath.toLowerCase().includes(kw)),
    );
  }
  return list;
});

function clearPreview() {
  previewChunks.value = [];
  previewApis.value = [];
  hasPreview.value = false;
}

watch(
  [currentProjectId, currentRequirementId],
  () => {
    clearPreview();
    searchKeyword.value = "";
    selectedApi.value = null;
  },
  { flush: "sync" },
);

// 如果当前项目完全没有需求版本，自动展开录入区
watch(
  requirements,
  (list) => {
    if (list.length === 0) {
      showInputPanel.value = true;
    }
  },
  { immediate: true },
);

function pickFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.markdown,.txt,.docx";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    fileName.value = file.name;
    fileSize.value = file.size;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      fileBase64.value = dataUrl;
      if (file.name.toLowerCase().endsWith(".docx")) clearPreview();
      else atobSafe(dataUrl);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function atobSafe(dataUrl: string) {
  try {
    const base64 = dataUrl.replace(/^data:[^,]*,/, "");
    const bin = atob(base64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    rawText.value = new TextDecoder("utf-8").decode(bytes);
    clearPreview();
  } catch {
    message.warning("文件解码失败，可直接粘贴文本");
  }
}

async function loadDemo() {
  try {
    const list = await api.listDemo();
    if (!list.length) {
      message.warning("未找到示例需求文件（demo-data 目录）");
      return;
    }
    const item = list[0];
    clearFile();
    rawText.value = item.text;
    label.value = "";
    showInputPanel.value = true;
    message.success(`已载入示例：${item.label}`);
  } catch (e) {
    message.error((e as Error).message);
  }
}

async function preview() {
  const text = rawText.value.trim();
  const attached = hasFile.value;
  if (!attached && !text) {
    message.warning("请先粘贴需求内容或选择文件");
    return;
  }
  const projectId = currentProjectId.value;
  const requirementId = currentRequirementId.value;
  previewing.value = true;
  try {
    const res = await api.previewRequirement(
      attached
        ? { base64: fileBase64.value, fileName: fileName.value }
        : { rawText: text },
    );
    if (
      currentProjectId.value !== projectId ||
      currentRequirementId.value !== requirementId
    )
      return;
    if (!attached && rawText.value.trim() !== text) return;
    hasPreview.value = true;
    previewChunks.value = res.chunks;
    previewApis.value = res.apiList;
    message.success(`切出 ${res.chunks.length} 条条款`);
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    previewing.value = false;
  }
}

async function save() {
  if (!currentProjectId.value) {
    message.warning("请先在顶部选择或新建项目");
    return;
  }
  const attached = hasFile.value;
  if (!attached && !rawText.value.trim()) {
    message.warning("请粘贴需求内容或选择文件");
    return;
  }
  const projectId = currentProjectId.value;
  saving.value = true;
  try {
    const created = await api.createRequirement(projectId, {
      label: label.value.trim(),
      rawText: rawText.value,
      fileBase64: attached ? fileBase64.value : undefined,
      fileName: attached ? fileName.value : undefined,
    });
    message.success(
      `已保存 ${created.label}，共 ${created.chunks.length} 条条款`,
    );
    if (created.inheritance) {
      const inh = created.inheritance;
      message.info(
        `已从「${inh.fromLabel}」继承 ${inh.sections}/${inh.totalChunks} 个未变条款的分析（${inh.points} 个测试点，其中 ${inh.confirmed} 个保留人工确认）；其余条款点击「分析需求」补齐。`,
        { duration: 8000 },
      );
    }
    if (currentProjectId.value !== projectId) return;
    if (!requirements.value.some((r) => r.id === created.id))
      requirements.value.push(created);
    clearPreview();
    clearFile();
    rawText.value = "";
    label.value = "";
    showInputPanel.value = false;
    emit("refresh");
    currentRequirementId.value = created.id;
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

function view(r: RequirementVersion) {
  currentRequirementId.value = r.id;
  clearPreview();
}

function removeRequirement(r: RequirementVersion) {
  dialog.warning({
    title: "删除需求版本",
    content: `确认删除「${r.label}」？该版本下的用例会一并删除。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await api.deleteRequirement(r.id);
        if (currentRequirementId.value === r.id) currentRequirementId.value = null;
        message.success("已删除");
        emit("refresh");
      } catch (e) {
        message.error((e as Error).message);
      }
    },
  });
}

function sourceLabel(t: string) {
  return (
    { paste: "粘贴文本", md: "Markdown", txt: "纯文本", docx: "Word 文档" }[
      t
    ] ?? t
  );
}

function focusChunk(c: Chunk) {
  setCanvasFocus({
    type: "chunk",
    id: c.reqId,
    title: c.sectionPath || `条款 ${c.reqId}`,
    subtitle: c.text.slice(0, 80),
  });
}

function toggleFocusChunk(c: Chunk) {
  if (canvasFocus.value?.id === c.reqId) {
    clearCanvasFocus();
  } else {
    focusChunk(c);
  }
}

function scrollToChunk(reqId: string) {
  const el = document.getElementById(`chunk-${reqId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("chunk-flash-highlight");
    setTimeout(() => el.classList.remove("chunk-flash-highlight"), 1600);
  }
}

function chunkApis(text: string): string[] {
  return displayApis.value.filter((api) => text.includes(api));
}

function toggleApiFilter(api: string) {
  if (selectedApi.value === api) {
    selectedApi.value = null;
  } else {
    selectedApi.value = api;
  }
}
</script>

<template>
  <div class="req-page">
    <!-- 顶部状态与快速动作栏 -->
    <header class="req-top-bar">
      <div class="bar-left">
        <div class="version-badge">
          <span class="v-icon">📄</span>
          <strong class="v-label">{{
            activeRequirement?.label || (hasPreview ? "未入库预览" : "未选版本")
          }}</strong>
          <n-tag
            v-if="activeRequirement"
            size="tiny"
            :bordered="false"
            round
            type="info"
          >
            {{ sourceLabel(activeRequirement.sourceType) }}
          </n-tag>
          <n-tag
            v-if="hasPreview"
            size="tiny"
            :bordered="false"
            round
            type="warning"
          >
            ⚠️ 临时预览
          </n-tag>
        </div>

        <div class="stats-pills">
          <span class="stat-pill">
            <span class="stat-num">{{ displayChunks.length }}</span>
            <span class="stat-txt">条条款</span>
          </span>
          <span v-if="displayApis.length" class="stat-pill">
            <span class="stat-num">{{ displayApis.length }}</span>
            <span class="stat-txt">个接口</span>
          </span>
          <span v-if="activeRequirement?.analysis" class="stat-pill success">
            <span class="stat-num">{{
              activeRequirement.analysis.sections.flatMap((s) => s.points)
                .length
            }}</span>
            <span class="stat-txt">个测试点已拆解</span>
          </span>
        </div>
      </div>

      <div class="bar-actions">
        <n-button
          size="small"
          :secondary="!showInputPanel"
          :type="showInputPanel ? 'warning' : 'default'"
          @click="showInputPanel = !showInputPanel"
        >
          {{ showInputPanel ? "收起录入" : "+ 录入 / 更新版本" }}
        </n-button>
        <n-button
          v-if="activeRequirement"
          size="small"
          type="primary"
          @click="currentRequirementId = activeRequirement.id; activeTab = 'points'"
        >
          {{ activeRequirement.analysis ? '下一步：核对测试点 →' : '下一步：分析需求、提炼测试点 →' }}
        </n-button>
      </div>
    </header>

    <details v-if="activeRequirement?.riskScans?.length && !hasPreview" class="scan-history">
      <summary>已保存 {{ activeRequirement.riskScans.length }} 次风险走查，点击继续处理</summary>
      <button v-for="scan in [...activeRequirement.riskScans].reverse()" :key="scan.id" type="button" class="chunk-action-btn" @click="openRiskScan(activeRequirement.id, scan.id)">
        {{ scan.targetReqId || '全篇' }} · {{ scan.summary }} · {{ scan.issues.length }} 项建议
      </button>
    </details>

    <!-- 可折叠的录入与切块控制区 -->
    <transition name="slide-down">
      <div
        v-if="showInputPanel || (!requirements.length && !hasPreview)"
        class="panel input-collapse-panel"
      >
        <div class="panel-inner-grid">
          <!-- 左侧输入区 -->
          <div class="input-col">
            <div class="input-head">
              <strong class="sub-title">录入需求正文</strong>
              <div class="input-toolbar-tools">
                <n-button size="tiny" secondary @click="pickFile"
                  >📂 选择文件 (.md/.txt/.docx)</n-button
                >
                <n-button size="tiny" quaternary @click="loadDemo"
                  >💡 载入示例需求</n-button
                >
              </div>
            </div>

            <n-input
              v-model:value="rawText"
              type="textarea"
              placeholder="粘贴需求正文或导入文档。Markdown 标题（# / ## / 3.1 这类编号标题）会自动切块为可追溯条款…"
              :autosize="{ minRows: 6, maxRows: 12 }"
              @input="onTextInput"
            />

            <div v-if="fileName" class="file-chip">
              <span class="file-name mono" :title="fileName"
                >📎 {{ fileName }}</span
              >
              <span class="tiny-text text-dim"
                >({{ (fileSize / 1024).toFixed(1) }} KB)</span
              >
              <span class="tiny-text text-dim file-hint">
                {{
                  isDocx
                    ? "保存时按该 Word 文件入库"
                    : "编辑文本框后改按文本保存"
                }}
              </span>
              <n-button size="tiny" text type="error" @click="clearFile"
                >移除附件</n-button
              >
            </div>
          </div>

          <!-- 右侧保存操作区 -->
          <div class="save-col">
            <strong class="sub-title">入库设置与操作</strong>
            <p class="save-tip">
              分块保留需求原文与条款编号，供后续测试点和用例定位引用；分块后还需分析测试目标。
            </p>

            <div class="save-controls">
              <n-input
                v-model:value="label"
                placeholder="版本标签（如 v1.0、v2.1）"
                size="small"
                class="version-input"
              />
              <div class="save-btns">
                <n-button
                  size="small"
                  secondary
                  :loading="previewing"
                  @click="preview"
                >
                  ⚡ 预览切块效果
                </n-button>
                <n-button
                  size="small"
                  type="primary"
                  :loading="saving"
                  @click="save"
                >
                  💾 保存为需求版本
                </n-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- 核心主体：需求条款全景浏览器 -->
    <div class="clause-workbench">
      <!-- 左侧：目录导航与接口过滤器 -->
      <aside class="sidebar-pane panel">
        <div class="sidebar-search">
          <n-input
            v-model:value="searchKeyword"
            placeholder="搜索条款编号、章节或内容…"
            size="small"
            clearable
          >
            <template #prefix>🔍</template>
          </n-input>
        </div>

        <!-- 识别接口筛选池 -->
        <div v-if="displayApis.length" class="apis-section">
          <div class="section-label">
            <span>接口快捷过滤 ({{ displayApis.length }})</span>
            <button
              v-if="selectedApi"
              type="button"
              class="clear-api-btn"
              @click="selectedApi = null"
            >
              清除
            </button>
          </div>
          <div class="apis-list">
            <button
              v-for="apiItem in displayApis"
              :key="apiItem"
              type="button"
              class="api-filter-chip mono"
              :class="{ active: selectedApi === apiItem }"
              @click="toggleApiFilter(apiItem)"
            >
              {{ apiItem }}
            </button>
          </div>
        </div>

        <!-- 条款章节目录树 -->
        <div class="clause-outline-section">
          <div class="section-label">
            <span>条款目录 ({{ filteredChunks.length }})</span>
          </div>
          <div class="outline-list">
            <div v-if="!filteredChunks.length" class="empty-outline">
              未找到匹配条款
            </div>
            <div
              v-for="c in filteredChunks"
              :key="c.reqId"
              class="outline-item"
              :class="{ 'is-focused': canvasFocus?.id === c.reqId }"
              @click="scrollToChunk(c.reqId)"
            >
              <span class="outline-id mono">{{ c.reqId }}</span>
              <span class="outline-title" :title="c.sectionPath || c.text">
                {{ c.sectionPath || c.text }}
              </span>
            </div>
          </div>
        </div>

        <!-- 历史版本切换区 -->
        <div v-if="requirements.length" class="versions-section">
          <div class="section-label">已存版本切换</div>
          <div class="versions-list">
            <div
              v-for="r in requirements"
              :key="r.id"
              class="version-item"
              :class="{ active: activeRequirement?.id === r.id }"
              @click="view(r)"
            >
              <div class="v-item-left">
                <strong>{{ r.label }}</strong>
                <small class="text-dim">{{ r.chunks.length }} 条</small>
              </div>
              <n-button
                size="tiny"
                quaternary
                type="error"
                title="删除此版本"
                @click.stop="removeRequirement(r)"
              >
                ✕
              </n-button>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧：条款卡片详情流 -->
      <main class="content-pane">
        <!-- 筛选提示条 -->
        <div v-if="searchKeyword || selectedApi" class="filter-banner">
          <span class="filter-tip">
            当前筛选：
            <span v-if="searchKeyword">关键词「{{ searchKeyword }}」</span>
            <span v-if="searchKeyword && selectedApi"> 且 </span>
            <span v-if="selectedApi">接口「{{ selectedApi }}」</span>
            · 匹配到 {{ filteredChunks.length }} 条条款
          </span>
          <button
            type="button"
            class="filter-reset-btn"
            @click="
              searchKeyword = '';
              selectedApi = null;
            "
          >
            清空条件
          </button>
        </div>

        <!-- 空数据提示 -->
        <div v-if="!displayChunks.length" class="panel empty-guide">
          <div class="empty-icon">📖</div>
          <h3>当前尚无已切块的需求资料</h3>
          <p>
            在上方录入或粘贴需求正文，点击「预览切块」或「保存为需求版本」即可生成结构化条款。
          </p>
          <n-button type="primary" size="small" @click="loadDemo"
            >载入示例数据体验</n-button
          >
        </div>

        <!-- 条款卡片流 -->
        <div v-else class="chunk-cards-stream">
          <article
            v-for="c in filteredChunks"
            :id="`chunk-${c.reqId}`"
            :key="c.reqId"
            class="chunk-card panel"
            :class="{ 'canvas-focused-chunk': canvasFocus?.id === c.reqId }"
            @click="toggleFocusChunk(c)"
          >
            <!-- 卡片头部信息 -->
            <div class="chunk-card-head">
              <div class="chunk-title-group">
                <span class="req-id mono">{{ c.reqId }}</span>
                <strong class="chunk-path">{{
                  c.sectionPath || "未命名条款章节"
                }}</strong>
                <span v-if="canvasFocus?.id === c.reqId" class="focus-chip"
                  >🎯 聚焦中</span
                >
              </div>
              <div class="chunk-meta-info">
                <span class="chunk-length-badge text-dim"
                  >{{ c.text.length }} 字符</span
                >
              </div>
            </div>

            <!-- 识别到的接口徽标 -->
            <div v-if="chunkApis(c.text).length" class="chunk-apis-bar">
              <span class="apis-bar-label">涉及接口：</span>
              <span
                v-for="apiTag in chunkApis(c.text)"
                :key="apiTag"
                class="chunk-api-badge mono"
                @click.stop="toggleApiFilter(apiTag)"
              >
                {{ apiTag }}
              </span>
            </div>

            <!-- 条款原文正文 -->
            <div class="chunk-body-text pre-wrap">{{ c.text }}</div>

          </article>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.scan-history { font-size: 12px; flex-shrink: 0; max-height: 160px; overflow: auto; }
.scan-history summary { cursor: pointer; }
.scan-history button { display: block; max-width: 100%; margin-top: 6px; white-space: normal; text-align: left; }
.req-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0 0 10px;
  box-sizing: border-box;
}

/* 顶部状态条 */
.req-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: #ffffff;
  border: 1px solid var(--tp-border, #e2e8f0);
  border-radius: 8px;
  flex-shrink: 0;
}
.bar-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.version-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}
.v-icon {
  font-size: 16px;
}
.v-label {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}
.stats-pills {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #f1f5f9;
  border-radius: 12px;
  font-size: 12px;
  color: #475569;
}
.stat-pill.success {
  background: #ecfdf5;
  color: #059669;
}
.stat-num {
  font-weight: 700;
  color: #1e293b;
}
.stat-pill.success .stat-num {
  color: #059669;
}
.bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 可折叠的录入面板 */
.input-collapse-panel {
  background: #ffffff;
  border: 1px solid var(--tp-border, #e2e8f0);
  border-radius: 8px;
  padding: 16px;
  flex-shrink: 0;
}
.panel-inner-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 20px;
}
.sub-title {
  font-size: 13px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 8px;
  display: block;
}
.input-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.input-toolbar-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.file-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}
.file-name {
  font-size: 12px;
  font-weight: 500;
  color: #2563eb;
}
.file-hint {
  margin-left: auto;
}
.save-tip {
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
  margin: 0 0 14px;
}
.save-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.save-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 主体：全景双栏工作台 */
.clause-workbench {
  display: flex;
  gap: 14px;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 左侧栏 (固定高度，占满可视区) */
.sidebar-pane {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #ffffff;
  border: 1px solid var(--tp-border, #e2e8f0);
  border-radius: 8px;
  padding: 14px;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: #64748b;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}
.clear-api-btn {
  font-size: 11px;
  color: #2563eb;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.clear-api-btn:hover {
  text-decoration: underline;
}

/* 接口池 */
.apis-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 110px;
  overflow-y: auto;
  padding-bottom: 4px;
}
.api-filter-chip {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.api-filter-chip:hover {
  background: #e2e8f0;
  border-color: #94a3b8;
}
.api-filter-chip.active {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}

/* 条款大纲滚动 */
.clause-outline-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.outline-list {
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
}
.outline-list::-webkit-scrollbar {
  width: 5px;
}
.outline-list::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}
.outline-list::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
.empty-outline {
  font-size: 12px;
  color: #94a3b8;
  padding: 12px 0;
  text-align: center;
}
.outline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
  font-size: 12px;
}
.outline-item:hover {
  background: #f1f5f9;
}
.outline-item.is-focused {
  background: #eff6ff;
  color: #1d4ed8;
}
.outline-id {
  font-size: 11px;
  font-weight: 700;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}
.outline-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
}

/* 历史版本 */
.versions-section {
  border-top: 1px solid #f1f5f9;
  padding-top: 8px;
}
.versions-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 100px;
  overflow-y: auto;
}
.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  background: #f8fafc;
  cursor: pointer;
  font-size: 12px;
}
.version-item:hover {
  background: #f1f5f9;
}
.version-item.active {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}
.v-item-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 右侧主内容流 (独立平滑滚动) */
.content-pane {
  flex: 1;
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 6px;
  box-sizing: border-box;
}
.filter-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 12px;
  color: #1e40af;
}
.filter-reset-btn {
  background: none;
  border: none;
  color: #2563eb;
  font-weight: 600;
  cursor: pointer;
}
.filter-reset-btn:hover {
  text-decoration: underline;
}

/* 空引导卡片 */
.empty-guide {
  padding: 48px 24px;
  text-align: center;
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
}
.empty-icon {
  font-size: 36px;
  margin-bottom: 8px;
}
.empty-guide h3 {
  margin: 0 0 6px;
  color: #1e293b;
  font-size: 16px;
}
.empty-guide p {
  color: #64748b;
  font-size: 13px;
  margin: 0 0 16px;
}

/* 条款卡片流 */
.chunk-cards-stream {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chunk-card {
  background: #ffffff;
  border: 1px solid var(--tp-border, #e2e8f0);
  border-radius: 8px;
  padding: 14px 16px;
  transition: all 0.2s ease;
  position: relative;
}
.chunk-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 2px 10px rgba(37, 99, 235, 0.06);
}
.chunk-card.canvas-focused-chunk {
  border-color: #3b82f6;
  background: #fafcff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
.chunk-flash-highlight {
  animation: flashYellow 1.5s ease;
}
@keyframes flashYellow {
  0%,
  100% {
    background: #ffffff;
  }
  30%,
  70% {
    background: #fef9c3;
    border-color: #eab308;
  }
}

.chunk-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.chunk-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.req-id {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
  padding: 2px 7px;
  border-radius: 4px;
}
.chunk-path {
  font-size: 14px;
  color: #1e293b;
  font-weight: 600;
}
.focus-chip {
  font-size: 10px;
  font-weight: 600;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  padding: 1px 6px;
  border-radius: 4px;
}
.chunk-length-badge {
  font-size: 11px;
}

.chunk-apis-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  padding: 4px 8px;
  background: #f8fafc;
  border-radius: 4px;
}
.apis-bar-label {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
}
.chunk-api-badge {
  font-size: 11px;
  color: #0369a1;
  background: #e0f2fe;
  border: 1px solid #bae6fd;
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.chunk-api-badge:hover {
  background: #bae6fd;
  color: #0284c7;
}

.chunk-body-text {
  font-size: 13px;
  line-height: 1.7;
  color: #334155;
  background: #fcfdfe;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid #f1f5f9;
}
.pre-wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chunk-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
  background: #ffffff;
}

/* 动效 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
  max-height: 0;
}

@media (max-width: 960px) {
  .clause-workbench {
    flex-direction: column;
  }
  .sidebar-pane {
    width: 100%;
    position: static;
    height: auto;
    max-height: none;
  }
  .panel-inner-grid {
    grid-template-columns: 1fr;
  }
}
</style>
