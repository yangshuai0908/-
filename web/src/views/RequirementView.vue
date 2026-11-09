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
import RequirementAnalysisPanel from "../components/RequirementAnalysisPanel.vue";
import {
  currentProject,
  currentProjectId,
  currentRequirement,
  currentRequirementId,
  requirements,
} from "../stores/workspace";
import type { Chunk } from "../types";

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

/** 正在展开查看条款的版本；为空时跟随顶部的版本下拉 */
const viewingId = ref<string | null>(null);

const activeRequirement = computed(() => {
  const candidate = viewingId.value
    ? (requirements.value.find((r) => r.id === viewingId.value) ??
      currentRequirement.value)
    : currentRequirement.value;
  return candidate?.projectId === currentProjectId.value ? candidate : null;
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

function clearPreview() {
  previewChunks.value = [];
  previewApis.value = [];
  hasPreview.value = false;
}

watch(
  [currentProjectId, currentRequirementId],
  () => {
    // 顶部下拉切换版本时不能继续查看或编辑左侧先前展开的版本。
    viewingId.value = null;
    clearPreview();
  },
  { flush: "sync" },
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
      // md/txt 直接在前端解出文本，用户能立刻看到原文；docx 交给后端解析
      if (file.name.toLowerCase().endsWith(".docx")) clearPreview();
      else atobSafe(dataUrl);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

/** dataURL → utf8 文本（md/txt 走这条路，避免中文乱码） */
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
    viewingId.value = null;
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
    if (currentProjectId.value !== projectId) return;
    if (!requirements.value.some((r) => r.id === created.id))
      requirements.value.push(created);
    clearPreview();
    clearFile();
    rawText.value = "";
    label.value = "";
    emit("refresh");
    currentRequirementId.value = created.id;
    viewingId.value = created.id;
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

function view(r: { id: string }) {
  viewingId.value = r.id;
  currentRequirementId.value = r.id;
  clearPreview();
}

function removeRequirement(r: { id: string; label: string }) {
  dialog.warning({
    title: "删除需求版本",
    content: `确认删除「${r.label}」？该版本下的用例会一并删除。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await api.deleteRequirement(r.id);
        if (viewingId.value === r.id) viewingId.value = null;
        message.success("已删除");
        emit("refresh");
      } catch (e) {
        message.error((e as Error).message);
      }
    },
  });
}

function sourceLabel(t: string) {
  return { paste: "粘贴", md: "Markdown", txt: "文本", docx: "Word" }[t] ?? t;
}
</script>

<template>
  <div class="page req-page">
    <div class="panel entry-panel">
      <div class="entry-main">
        <h3 class="section-title">录入需求</h3>

        <n-input
          v-model:value="rawText"
          type="textarea"
          placeholder="粘贴需求正文，或点下方「选择文件」导入 .md / .txt / .docx。Markdown 标题（# / ## / 3.1 这类编号标题）会自动识别为条款。"
          :autosize="{ minRows: 7, maxRows: 18 }"
          @input="onTextInput"
        />

        <div class="input-toolbar">
          <div class="toolbar-left">
            <n-button size="tiny" secondary @click="pickFile"
              >选择文件</n-button
            >
            <n-button size="tiny" quaternary @click="loadDemo"
              >载入示例需求</n-button
            >
          </div>
          <span class="tiny-text text-dim">.md / .txt / .docx</span>
        </div>

        <div v-if="fileName" class="file-chip">
          <span class="file-name mono" :title="fileName">{{ fileName }}</span>
          <span class="tiny-text text-dim"
            >{{ (fileSize / 1024).toFixed(1) }} KB</span
          >
          <span class="tiny-text text-dim file-hint">{{
            isDocx ? "保存时按该 Word 文件入库" : "编辑文本框后改按文本保存"
          }}</span>
          <n-button size="tiny" text @click="clearFile">移除</n-button>
        </div>

        <div class="save-row">
          <n-input-group>
            <n-input
              v-model:value="label"
              placeholder="版本标签，如 v1"
              size="small"
              class="version-input"
            />
            <n-button size="small" :loading="previewing" @click="preview"
              >预览切块</n-button
            >
            <n-button
              size="small"
              type="primary"
              :loading="saving"
              @click="save"
              >保存为需求版本</n-button
            >
          </n-input-group>
        </div>
      </div>

      <div class="entry-preview">
        <div class="panel-head">
          <div class="head-title">
            <h3 class="section-title">条款预览</h3>
            <n-tag size="tiny" :bordered="false" round>{{
              displayChunks.length
            }}</n-tag>
            <n-tag
              v-if="hasPreview"
              size="tiny"
              type="warning"
              :bordered="false"
              >未保存的预览</n-tag
            >
          </div>
          <div v-if="currentProject" class="tiny-text text-dim head-context">
            {{ currentProject.name
            }}<template v-if="activeRequirement && !hasPreview">
              · {{ activeRequirement.label }}</template
            >
          </div>
        </div>

        <div v-if="displayApis.length" class="api-strip">
          <span class="tiny-text text-dim">识别到接口</span>
          <span v-for="a in displayApis" :key="a" class="api-chip mono">{{
            a
          }}</span>
        </div>

        <n-spin v-if="previewing" style="display: block; margin: 40px auto" />
        <n-scrollbar v-else-if="displayChunks.length" class="chunk-scroll">
          <div v-for="c in displayChunks" :key="c.reqId" class="chunk-item">
            <div class="chunk-meta">
              <span class="req-id mono">{{ c.reqId }}</span>
              <span class="section-path">{{ c.sectionPath }}</span>
            </div>
            <div class="chunk-text">{{ c.text }}</div>
          </div>
        </n-scrollbar>
        <div v-else class="empty chunk-empty">
          粘贴需求后点「预览切块」，或点击右侧已保存版本查看条款
        </div>
      </div>

      <aside class="entry-versions" aria-label="已保存版本">
        <div class="versions-head">
          <h3 class="section-title">已保存版本</h3>
          <n-tag size="tiny" :bordered="false" round>{{
            requirements.length
          }}</n-tag>
        </div>
        <div class="versions-list">
          <div v-if="!requirements.length" class="versions-empty text-dim">
            保存后，需求版本将显示在这里
          </div>
          <div
            v-for="r in requirements"
            :key="r.id"
            class="version-row"
            :class="{ active: activeRequirement?.id === r.id }"
            @click="view(r)"
          >
            <div class="version-main">
              <span class="version-label" :title="r.label">{{ r.label }}</span>
              <n-tag size="tiny" :bordered="false">{{
                sourceLabel(r.sourceType)
              }}</n-tag>
              <span class="tiny-text text-dim"
                >{{ r.chunks.length }} 条条款</span
              >
            </div>
            <n-button
              size="tiny"
              quaternary
              type="error"
              @click.stop="removeRequirement(r)"
              >删除</n-button
            >
          </div>
        </div>
      </aside>
    </div>

    <div class="req-cols">
      <requirement-analysis-panel
        v-if="!hasPreview && activeRequirement"
        class="analysis-col"
        :key="activeRequirement.id"
        :requirement="activeRequirement"
      />
      <div v-else class="panel analysis-col">
        <div class="panel-head">
          <div class="head-title">
            <h3 class="section-title">需求理解与测试点</h3>
          </div>
          <span class="tiny-text text-dim">此步不修改已有用例</span>
        </div>
        <div class="empty chunk-empty">
          {{
            hasPreview
              ? "当前为未保存预览，请先保存为需求版本后再分析。"
              : !currentProjectId
                ? "请先选择项目，并保存或选择需求版本。"
                : "请先保存需求，或选择一个已保存的需求版本。"
          }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.req-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.entry-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 280px;
  align-items: stretch;
  gap: 18px;
}

.entry-main {
  min-width: 0;
}

.entry-preview,
.entry-versions {
  min-width: 0;
  padding-left: 18px;
  border-left: 1px solid var(--tp-border);
}

.entry-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  contain: size;
}

.entry-preview > .panel-head,
.entry-preview > .api-strip {
  flex-shrink: 0;
}

.entry-versions {
  display: flex;
  flex-direction: column;
}

.versions-list {
  flex: 1;
  min-height: 0;
  max-height: 260px;
  overflow-y: auto;
  padding-right: 4px;
}

.req-cols {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.req-cols > .panel + .panel {
  margin-top: 0;
}

.analysis-col {
  flex: 1;
  min-width: 0;
}

.tiny-text {
  font-size: 12px;
}

.save-row {
  margin-top: 14px;
}

.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--tp-panel-2);
  border: 1px solid var(--tp-border);
  border-radius: 6px;
}

.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.file-hint {
  margin-left: auto;
  white-space: nowrap;
}

.version-input {
  flex: 1;
  min-width: 0;
}

.versions-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.versions-head .section-title {
  margin: 0;
}

.versions-empty {
  padding: 14px 10px;
  border-radius: 6px;
  background: var(--tp-panel-2);
  font-size: 12px;
  text-align: center;
}

.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.version-row:hover {
  background: var(--tp-panel-2);
}

.version-row.active {
  background: rgba(69, 107, 145, 0.1);
}

.version-row + .version-row {
  margin-top: 4px;
}

.version-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-right: 8px;
}

.version-main .n-tag,
.version-main .tiny-text {
  flex-shrink: 0;
}

.version-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--tp-border);
}

.head-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.head-title .section-title {
  margin: 0;
}

.head-context {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-preview :deep(.chunk-scroll) {
  flex: 1;
  min-height: 0;
  padding-right: 6px;
}

.api-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin: -2px 0 12px;
}

.api-chip {
  font-size: 11px;
  color: var(--tp-accent);
  background: var(--tp-panel-2);
  border: 1px solid var(--tp-border);
  padding: 1px 6px;
  border-radius: 4px;
}

.chunk-item {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--tp-panel-2);
  transition: background 0.15s;
}

.chunk-item + .chunk-item {
  margin-top: 8px;
}

.chunk-item:hover {
  background: #eef1f5;
}

.chunk-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  min-width: 0;
}

.req-id {
  font-size: 11px;
  color: var(--tp-accent);
  background: rgba(69, 107, 145, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  flex-shrink: 0;
}

.section-path {
  font-size: 12px;
  color: var(--tp-text-dim);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chunk-text {
  font-size: 13px;
  line-height: 1.75;
  color: var(--tp-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.chunk-empty {
  padding: 36px 0;
}

@media (max-width: 1100px) {
  .entry-panel {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }

  .entry-preview,
  .entry-versions {
    padding-left: 0;
    padding-top: 16px;
    border-left: 0;
    border-top: 1px solid var(--tp-border);
  }

  .entry-preview {
    contain: none;
  }

  .entry-preview :deep(.chunk-scroll) {
    flex: none;
    max-height: 260px;
  }

  .versions-list {
    max-height: none;
  }

  .req-cols {
    flex-direction: column;
  }
}
</style>
