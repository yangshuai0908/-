<script lang="ts">
import { reactive } from "vue";

// 切走再切回同一版本时，仍禁用该版本的重复请求；不影响其他版本。
const pendingRequests = reactive(
  new Map<string, "load" | "analyze" | "save">(),
);
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  NAlert,
  NButton,
  NDrawer,
  NDrawerContent,
  NInput,
  NSelect,
  NSpin,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { api } from "../api/client";
import WorkflowHistory from './WorkflowHistory.vue';
import { requirements } from "../stores/workspace";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  type Category,
  type RequirementAnalysis,
  type RequirementVersion,
  type TestPoint,
} from "../types";

const props = defineProps<{ requirement: RequirementVersion }>();
const dialog = useDialog();
const message = useMessage();
// 父组件以 requirement.id 挂 key，所有异步回写都使用请求发起时的版本。
const requirementId = props.requirement.id;
const projectId = props.requirement.projectId;
const versionLabel = props.requirement.label;
const analysis = computed(() => props.requirement.analysis ?? null);
const operation = computed(() => pendingRequests.get(requirementId));
const busy = computed(() => Boolean(operation.value));
const hasContent = computed(() =>
  props.requirement.chunks.some((chunk) => chunk.text.trim()),
);
const error = ref("");
const loadFailed = ref(false);
const editorError = ref("");
const showHistory = ref(false);
let active = true;
let confirmation: ReturnType<typeof dialog.warning> | null = null;

interface PointDraft {
  analysisId: string;
  analysisUpdatedAt: string;
  pointId: string;
  title: string;
  category: Category;
  objective: string;
  questionsText: string;
  evidence: { reqId: string; quote: string }[];
}
const draft = ref<PointDraft | null>(null);
const categoryOptions = (Object.keys(CATEGORY_LABEL) as Category[]).map(
  (category) => ({
    label: CATEGORY_LABEL[category],
    value: category,
  }),
);
const chunkOptions = computed(() =>
  props.requirement.chunks.map((chunk) => ({
    label: `${chunk.reqId} · ${chunk.sectionPath}`,
    value: chunk.reqId,
  })),
);
const chunksById = computed(
  () => new Map(props.requirement.chunks.map((chunk) => [chunk.reqId, chunk])),
);
const statusLabel: Record<TestPoint["status"], string> = {
  pending: "待确认",
  confirmed: "已确认",
  excluded: "已排除",
};
const statusType = {
  pending: "warning",
  confirmed: "success",
  excluded: "default",
} as const;
const counts = computed(() => {
  const result = { pending: 0, confirmed: 0, excluded: 0 };
  for (const section of analysis.value?.sections ?? []) {
    for (const point of section.points) result[point.status]++;
  }
  return result;
});
const pointTotal = computed(() =>
  (analysis.value?.sections ?? []).reduce(
    (sum, section) => sum + section.points.length,
    0,
  ),
);

function stamp(value: RequirementAnalysis | null | undefined) {
  return value ? `${value.id}:${value.updatedAt}` : "";
}

function writeAnalysis(
  result: RequirementAnalysis | null,
  previousStamp: string,
) {
  const target = requirements.value.find(
    (r) => r.id === requirementId && r.projectId === projectId,
  );
  if (!target || stamp(target.analysis) !== previousStamp) return false;
  target.analysis = result ?? undefined;
  return true;
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : "请求失败，请稍后重试";
}

async function loadAnalysis() {
  if (busy.value) return;
  const previousStamp = stamp(analysis.value);
  pendingRequests.set(requirementId, "load");
  error.value = "";
  try {
    const result = await api.getRequirementAnalysis(requirementId);
    // 读取期间 Agent 或另一请求可能已更新工作区，不能覆盖较新的分析。
    writeAnalysis(result, previousStamp);
    loadFailed.value = false;
  } catch (e) {
    if (active) {
      error.value = `加载分析失败：${errorText(e)}`;
      loadFailed.value = true;
    }
  } finally {
    pendingRequests.delete(requirementId);
  }
}

async function analyze(replaceAnalysisId?: string) {
  if (!active || busy.value || !hasContent.value || loadFailed.value) return;
  if (analysis.value?.id !== replaceAnalysisId) {
    error.value = "分析版本已变化，请刷新后重新确认。";
    return;
  }
  const previousStamp = stamp(analysis.value);
  pendingRequests.set(requirementId, "analyze");
  error.value = "";
  try {
    const result = await api.analyzeRequirement(
      requirementId,
      replaceAnalysisId ? { replaceAnalysisId } : {},
    );
    const applied = writeAnalysis(result, previousStamp);
    if (active) {
      if (applied) message.success("需求分析已完成，请逐项核对测试目标");
      else
        error.value =
          "分析已完成，但该版本的数据已变化。为避免覆盖新结果，请刷新分析。";
    }
  } catch (e) {
    // 不清空旧结果，重分析失败仍可查看此前的人工核对内容。
    const detail = `分析失败：${errorText(e)}`;
    if (active) error.value = detail;
    else message.error(`「${versionLabel}」${detail}`);
  } finally {
    pendingRequests.delete(requirementId);
  }
}

function requestAnalysis() {
  if (busy.value || draft.value || confirmation) return;
  const previous = analysis.value;
  if (!previous) {
    void analyze();
    return;
  }
  confirmation = dialog.warning({
    title: "重新分析需求",
    content: `重新分析「${versionLabel}」将调用真实模型，可能耗时较长。成功后会替换现有测试点，人工修改及确认／排除状态不会保留；失败则保留原分析。此操作不修改已有用例。是否继续？`,
    positiveText: "确认重新分析",
    negativeText: "取消",
    onPositiveClick: () => {
      void analyze(previous.id);
    },
    onAfterLeave: () => {
      confirmation = null;
    },
  });
}

function openEditor(point: TestPoint, reqId: string) {
  if (busy.value || !analysis.value) return;
  editorError.value = "";
  draft.value = {
    analysisId: analysis.value.id,
    analysisUpdatedAt: analysis.value.updatedAt,
    pointId: point.id,
    title: point.title,
    category: point.category,
    objective: point.objective,
    questionsText: point.questions.join("\n"),
    evidence: point.evidence.length
      ? point.evidence.map(({ reqId: evidenceReqId, quote }) => ({
          reqId: evidenceReqId,
          quote,
        }))
      : [{ reqId, quote: "" }],
  };
}

function closeEditor() {
  if (busy.value) return;
  draft.value = null;
  editorError.value = "";
}

async function savePoint(status: TestPoint["status"] = "pending") {
  if (busy.value || !draft.value) return;
  const editing = draft.value;
  const analysisId = editing.analysisId;
  const previousStamp = stamp(analysis.value);
  if (analysis.value?.id !== analysisId) {
    editorError.value = "分析版本已变化，请取消并刷新后重新编辑。";
    return;
  }
  pendingRequests.set(requirementId, "save");
  editorError.value = "";
  try {
    const result = await api.updateRequirementAnalysisPoint(
      requirementId,
      editing.pointId,
      {
        analysisId,
        analysisUpdatedAt: editing.analysisUpdatedAt,
        title: editing.title.trim(),
        category: editing.category,
        objective: editing.objective.trim(),
        evidence: editing.evidence.map(({ reqId, quote }) => ({
          reqId,
          quote,
        })),
        questions: editing.questionsText
          .split(/\r?\n/)
          .map((q) => q.trim())
          .filter(Boolean),
        status,
      },
    );
    const applied = writeAnalysis(result, previousStamp);
    if (active && draft.value === editing) {
      if (applied) {
        draft.value = null;
        message.success(`测试点已保存为「${statusLabel[status]}」`);
      } else {
        editorError.value =
          "该版本分析已更新，未覆盖新结果。请取消编辑并刷新分析。";
      }
    }
  } catch (e) {
    // 包括引用缺失／未匹配及 409 冲突，保留编辑草稿和抽屉供修正。
    if (active) editorError.value = `保存失败：${errorText(e)}`;
    else message.error(`「${versionLabel}」测试点保存失败：${errorText(e)}`);
  } finally {
    pendingRequests.delete(requirementId);
  }
}

watch(
  () => analysis.value?.id,
  (id) => {
    if (draft.value && draft.value.analysisId !== id) {
      draft.value = null;
      editorError.value = "";
      message.warning("分析已被更新，已关闭旧测试点编辑，请基于新分析重新核对");
    }
  },
);
onMounted(() => {
  void loadAnalysis();
});
onBeforeUnmount(() => {
  active = false;
  draft.value = null;
  confirmation?.destroy();
});
</script>

<template>
  <section class="panel">
    <div class="analysis-head">
      <div class="head-title">
        <h3 class="section-title">需求理解与测试点</h3>
        <n-tag v-if="analysis" size="tiny" :bordered="false" round>{{
          pointTotal
        }}</n-tag>
      </div>
      <div class="button-row">
        <n-button size="small" quaternary @click="showHistory = true">流程追溯</n-button>
        <n-button
          size="small"
          quaternary
          :disabled="busy || Boolean(draft)"
          @click="loadAnalysis"
          >刷新分析</n-button
        >
        <n-button
          size="small"
          type="primary"
          :loading="operation === 'analyze'"
          :disabled="busy || !hasContent || loadFailed || Boolean(draft)"
          @click="requestAnalysis"
          >{{ analysis ? "重新分析" : "分析需求" }}</n-button
        >
      </div>
    </div>
    <div class="head-note text-dim small-text">
      版本 {{ requirement.label }} ·
      生成用例之前核对测试范围，此步不修改已有用例。
    </div>

    <n-alert v-if="error" type="error" class="notice" title="请求未完成">
      {{ error }}
      <div class="small-text">
        {{
          loadFailed
            ? "请点击「刷新分析」重试加载。"
            : analysis
              ? "已有分析仍保留；可重试，若提示并发或版本冲突，请先刷新分析。"
              : "可点击「分析需求」重试；若提示并发或版本冲突，请先刷新分析。"
        }}
      </div>
    </n-alert>
    <div v-if="operation" class="loading-note" role="status">
      <n-spin size="small" />
      <span>{{
        operation === "analyze"
          ? "正在调用真实模型理解需求并拆分测试点，可能需要较长时间，请勿重复提交。"
          : operation === "save"
            ? "正在保存测试点并校验原文引用…"
            : "正在加载已保存的需求分析…"
      }}</span>
    </div>
    <div v-if="!hasContent" class="empty">
      当前需求没有可分析的正文条款，请先保存包含正文的需求版本。
    </div>
    <div v-else-if="!analysis && !busy && !loadFailed" class="empty">
      尚未分析。点击「分析需求」，先核对测试目标、原文引用与待确认问题。
    </div>

    <template v-if="analysis">
      <div class="stats-row">
        <span class="small-text text-dim">测试点状态数量（不是覆盖率）</span>
        <n-tag size="small" type="warning" :bordered="false"
          >待确认 {{ counts.pending }}</n-tag
        >
        <n-tag size="small" type="success" :bordered="false"
          >已确认 {{ counts.confirmed }}</n-tag
        >
        <n-tag size="small" :bordered="false"
          >已排除 {{ counts.excluded }}</n-tag
        >
      </div>
      <n-alert type="info" :show-icon="false" class="notice">
        原文定位不等于测试目标已被需求支持。「确认」仅表示人工认可测试目标，不代表待确认问题已解决，也不代表规则已自动校验。
      </n-alert>
      <div v-if="!analysis.sections.length" class="empty">
        分析未返回条款或测试点，请核对需求内容后重试。
      </div>
      <article
        v-for="section in analysis.sections"
        :key="section.reqId"
        class="analysis-section"
      >
        <div class="section-heading">
          <span class="mono req-id">{{ section.reqId }}</span>
          <strong>{{
            chunksById.get(section.reqId)?.sectionPath || "未找到对应条款"
          }}</strong>
          <span class="text-dim small-text"
            >{{ section.points.length }} 个测试点</span
          >
        </div>
        <details v-if="chunksById.has(section.reqId)" class="origin">
          <summary>查看条款原文</summary>
          <div class="pre-wrap">{{ chunksById.get(section.reqId)?.text }}</div>
        </details>
        <div v-if="section.questions.length" class="questions">
          <strong>条款级待确认问题</strong>
          <ul>
            <li v-for="(question, index) in section.questions" :key="index">
              {{ question }}
            </li>
          </ul>
        </div>
        <div v-if="section.notTestableReason" class="reason pre-wrap">
          <strong>不适用理由：</strong>{{ section.notTestableReason }}
        </div>
        <div v-if="!section.points.length" class="text-dim small-text">
          本条款暂无测试点，请结合待确认问题或不适用理由核对。
        </div>
        <div v-for="point in section.points" :key="point.id" class="point-card">
          <div class="point-head">
            <strong class="point-title">{{
              point.title || "未填写名称"
            }}</strong>
            <n-tag
              size="tiny"
              :bordered="false"
              :color="{
                color: CATEGORY_COLOR[point.category] + '18',
                textColor: CATEGORY_COLOR[point.category],
              }"
              >{{ CATEGORY_LABEL[point.category] }}</n-tag
            >
            <n-tag
              size="tiny"
              :bordered="false"
              :type="statusType[point.status]"
              >{{ statusLabel[point.status] }}</n-tag
            >
            <n-button
              size="tiny"
              quaternary
              :disabled="busy"
              @click="openEditor(point, section.reqId)"
              >编辑 / 核对</n-button
            >
          </div>
          <div class="objective pre-wrap">
            <span class="text-dim">验证目标：</span
            >{{ point.objective || "未填写验证目标" }}
          </div>
          <div class="small-text text-dim">原文引用</div>
          <div v-if="!point.evidence.length" class="questions">
            缺少原文引用，不能确认测试点。
          </div>
          <div
            v-for="(evidence, index) in point.evidence"
            :key="index"
            class="evidence-item"
            :class="evidence.matched ? 'matched' : 'unmatched'"
          >
            <div class="evidence-head">
              <span class="mono req-id">{{
                evidence.reqId || "未选条款"
              }}</span>
              <n-tag
                size="tiny"
                :bordered="false"
                :type="evidence.matched ? 'success' : 'warning'"
                >{{ evidence.matched ? "原文已定位" : "未匹配" }}</n-tag
              >
            </div>
            <div class="pre-wrap">{{ evidence.quote || "未填写引用文本" }}</div>
          </div>
          <div v-if="point.questions.length" class="questions">
            <strong>测试点待确认问题</strong>
            <ul>
              <li v-for="(question, index) in point.questions" :key="index">
                {{ question }}
              </li>
            </ul>
          </div>
        </div>
      </article>
    </template>

    <n-drawer
      :show="Boolean(draft)"
      placement="right"
      :width="660"
      style="max-width: 100vw"
      :mask-closable="!busy"
      :close-on-esc="!busy"
      @update:show="(show) => !show && closeEditor()"
    >
      <n-drawer-content v-if="draft" title="编辑测试点" :closable="!busy">
        <n-alert type="info" :show-icon="false" class="notice">
          内容修改后默认保存为待确认。确认仅表示人工认可测试目标，不消除待确认问题，也不自动校验规则；确认时所有引用必须通过后端原文定位校验。
        </n-alert>
        <n-alert v-if="editorError" type="error" class="notice">{{
          editorError
        }}</n-alert>
        <div class="form">
          <label>测试点名称</label>
          <n-input v-model:value="draft.title" :disabled="busy" size="small" />
          <label>分类</label>
          <n-select
            v-model:value="draft.category"
            :options="categoryOptions"
            :disabled="busy"
            size="small"
          />
          <label>验证目标</label>
          <n-input
            v-model:value="draft.objective"
            type="textarea"
            :autosize="{ minRows: 3 }"
            :disabled="busy"
            size="small"
          />
          <label>待确认问题（一行一条）</label>
          <n-input
            v-model:value="draft.questionsText"
            type="textarea"
            :autosize="{ minRows: 2 }"
            :disabled="busy"
            size="small"
          />
          <label>原文引用（至少一条）</label>
          <div class="text-dim small-text">
            可从下方条款原文复制引用；定位结果以保存时的后端校验为准，定位成功不等于目标已获支持。
          </div>
          <div
            v-for="(evidence, index) in draft.evidence"
            :key="index"
            class="evidence-editor"
          >
            <div class="evidence-head">
              <span class="small-text">引用 {{ index + 1 }}</span>
              <n-button
                size="tiny"
                quaternary
                type="error"
                :disabled="busy || draft.evidence.length <= 1"
                @click="draft.evidence.splice(index, 1)"
                >删除引用</n-button
              >
            </div>
            <n-select
              v-model:value="evidence.reqId"
              :options="chunkOptions"
              filterable
              placeholder="选择引用条款"
              :disabled="busy"
              size="small"
            />
            <n-input
              v-model:value="evidence.quote"
              type="textarea"
              :autosize="{ minRows: 2 }"
              placeholder="填写引用的原文"
              :disabled="busy"
              size="small"
            />
            <details class="origin">
              <summary>查看引用条款原文</summary>
              <div class="pre-wrap">
                {{
                  chunksById.get(evidence.reqId)?.text ||
                  "未找到对应条款，请重新选择"
                }}
              </div>
            </details>
          </div>
          <n-button
            size="small"
            dashed
            :disabled="busy"
            @click="
              draft.evidence.push({
                reqId: requirement.chunks[0]?.reqId ?? '',
                quote: '',
              })
            "
            >新增引用</n-button
          >
        </div>
        <template #footer>
          <div class="drawer-actions">
            <n-button size="small" :disabled="busy" @click="closeEditor"
              >取消</n-button
            >
            <n-button
              size="small"
              :disabled="busy"
              @click="savePoint('excluded')"
              >排除测试点</n-button
            >
            <n-button
              size="small"
              type="success"
              :disabled="busy"
              @click="savePoint('confirmed')"
              >确认测试点</n-button
            >
            <n-button
              size="small"
              type="primary"
              :loading="operation === 'save'"
              :disabled="busy"
              @click="savePoint()"
              >保存为待确认</n-button
            >
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
    <workflow-history v-model:show="showHistory" :requirement-id="requirementId" />
  </section>
</template>

<style scoped>
.analysis-head,
.point-head,
.section-heading,
.evidence-head,
.stats-row,
.button-row,
.drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.analysis-head {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: nowrap;
  margin-bottom: 6px;
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
.button-row {
  flex-shrink: 0;
  flex-wrap: nowrap;
}
.head-note {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--tp-border);
}
.small-text,
.origin {
  font-size: 12px;
}
.notice {
  margin-bottom: 12px;
}
.loading-note {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0;
  color: var(--tp-text-dim);
  font-size: 13px;
}
.stats-row {
  margin-bottom: 12px;
}
.analysis-section {
  padding: 14px 0;
  font-size: 13px;
  line-height: 1.7;
}
.analysis-section + .analysis-section {
  border-top: 1px solid var(--tp-border);
}
.section-heading {
  margin-bottom: 8px;
}
.req-id {
  color: var(--tp-accent);
  background: rgba(69, 107, 145, 0.12);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
.origin {
  margin: 8px 0;
  color: var(--tp-text-dim);
}
.origin summary {
  cursor: pointer;
}
.origin .pre-wrap {
  margin-top: 8px;
}
.pre-wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.point-card {
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  transition: border-color 0.15s;
}
.point-card:hover {
  border-color: #d3dae1;
}
.point-title {
  flex: 1;
  min-width: 120px;
  overflow-wrap: anywhere;
}
.objective {
  margin: 10px 0;
}
.evidence-item {
  padding: 8px 10px;
  margin-top: 6px;
  background: var(--tp-panel-2);
  border-left: 2px solid var(--tp-border);
  border-radius: 0 6px 6px 0;
}
.evidence-item.matched {
  border-left-color: var(--tp-green);
}
.evidence-item.unmatched {
  border-left-color: var(--tp-yellow);
  background: rgba(167, 121, 47, 0.07);
}
.evidence-head {
  justify-content: space-between;
  margin-bottom: 6px;
}
.questions,
.reason {
  margin: 10px 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--tp-panel-2);
  overflow-wrap: anywhere;
}
.questions ul {
  margin: 4px 0 0;
  padding-left: 20px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form > label {
  margin-top: 8px;
  color: var(--tp-text-dim);
  font-size: 12px;
}
.evidence-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--tp-border);
  border-radius: 6px;
  padding: 10px;
}
.drawer-actions {
  justify-content: flex-end;
  width: 100%;
}
</style>
