<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NDrawer,
  NDrawerContent,
  NInput,
  NSelect,
  NSpin,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { api, streamGenerate } from "../api/client";
import EvidenceBadge from "../components/EvidenceBadge.vue";
import WorkflowHistory from "../components/WorkflowHistory.vue";
import {
  bumpCases,
  cases,
  casesRevision,
  currentRequirement,
  currentRequirementId,
} from "../stores/workspace";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  COST_COLOR,
  COST_LABEL,
  STATE_COLOR,
  STATE_LABEL,
  VERDICT_COLOR,
  VERDICT_LABEL,
  assessmentOf,
  evidenceStateOf,
  evidenceNeedsRecheck,
  type Assessment,
  type Category,
  type Evidence,
  type EvidenceState,
  type Priority,
  type RevisionCost,
  type TestCase,
  type Verdict,
} from "../types";

const message = useMessage();
const dialog = useDialog();

const ALL: Category[] = ["normal", "abnormal", "boundary", "permission"];

const loading = ref(false);
const generating = ref(false);
const recheckingAll = ref(false);
const recheckedCount = ref(0);
const progress = ref({ done: 0, total: 0, message: "" });
const selected = ref<Category[]>([...ALL]);
const estimate = ref<{ chunks: number; points: number; pending: number; excluded: number; batches: number; calls: number } | null>(
  null,
);
const showHistory = ref(false);
const historyRunId = ref('');
const historyCaseId = ref('');
function openHistory(runId = '', caseId = '') {
  historyRunId.value = runId;
  historyCaseId.value = caseId;
  showHistory.value = true;
}
const confirmedPoints = computed(() => (currentRequirement.value?.analysis?.sections ?? []).flatMap(section => section.points).filter(point => point.status === 'confirmed' && selected.value.includes(point.category)));
const linkedPointCount = computed(() => confirmedPoints.value.filter(point => cases.value.some(c => c.source?.pointId === point.id && c.source.analysisId === currentRequirement.value?.analysis?.id)).length);
const pointLinks = computed(() => confirmedPoints.value.map(point => ({
  point, cases: cases.value.filter(c => c.source?.pointId === point.id && c.source.analysisId === currentRequirement.value?.analysis?.id),
})));
const assumptions = ref<string[]>([]);
const duplicates = ref<
  { caseIds: string[]; title: string; reason: string; score: number }[]
>([]);

const filterCategory = ref<"all" | Category>("all");
const filterState = ref<"all" | EvidenceState>("all");
const keyword = ref("");

const categoryOptions = [
  { label: "全部", value: "all" },
  ...ALL.map((c) => ({ label: CATEGORY_LABEL[c], value: c })),
];

const priorityOptions: { label: string; value: Priority }[] = [
  { label: "P0", value: "P0" },
  { label: "P1", value: "P1" },
  { label: "P2", value: "P2" },
];

const stateOptions = [
  { label: "全部依据", value: "all" },
  { label: "明确支持", value: "explicit" },
  { label: "推导待确认", value: "inferred" },
  { label: "依据不足", value: "unknown" },
];

const VERDICTS: Verdict[] = [
  "unreviewed",
  "effective",
  "needs_revision",
  "invalid",
];
const COSTS: RevisionCost[] = ["none", "low", "medium", "high"];

const verdictOptions = [
  { label: "全部评审状态", value: "all" },
  ...VERDICTS.map((v) => ({ label: VERDICT_LABEL[v], value: v })),
];
// Naive UI 的 options 用 label/value；原生 select 也复用同一份
const verdictSelectOptions = VERDICTS.map((v) => ({
  label: VERDICT_LABEL[v],
  value: v,
}));
const costSelectOptions = COSTS.map((c) => ({
  label: COST_LABEL[c],
  value: c,
}));

/** 评审人记在浏览器本地，切换用例不用反复填 */
const reviewerName = ref(localStorage.getItem("tp.reviewer") ?? "");
watch(reviewerName, (v) => localStorage.setItem("tp.reviewer", v.trim()));

const filterVerdict = ref<"all" | Verdict>("all");

function clearFilters() {
  filterCategory.value = "all";
  filterState.value = "all";
  filterVerdict.value = "all";
  keyword.value = "";
}

function overallOf(c: TestCase): EvidenceState {
  return evidenceStateOf(c.evidence);
}

let casesRequestId = 0;
async function loadCases() {
  const requestId = ++casesRequestId;
  const requirementId = currentRequirementId.value;
  const categories = [...selected.value];
  if (!requirementId) {
    cases.value = [];
    duplicates.value = [];
    estimate.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [items, repeated, plan] = await Promise.all([
      api.listCases(requirementId), api.listDuplicates(requirementId), api.estimateGenerate(requirementId, categories),
    ]);
    if (requestId !== casesRequestId || requirementId !== currentRequirementId.value) return;
    cases.value = items;
    duplicates.value = repeated;
    estimate.value = plan;
  } catch (error) {
    if (requestId === casesRequestId) message.error((error as Error).message);
  } finally { if (requestId === casesRequestId) loading.value = false; }
}

watch(currentRequirementId, loadCases);
watch(casesRevision, async () => {
  const requirementId = currentRequirementId.value;
  if (!requirementId) return;
  try {
    const repeated = await api.listDuplicates(requirementId);
    if (requirementId === currentRequirementId.value) duplicates.value = repeated;
  } catch {
    duplicates.value = [];
  }
});
watch(selected, loadCases);

onMounted(loadCases);
watch(() => currentRequirement.value?.analysis?.updatedAt, () => { void loadCases(); });

const stats = computed(() => {
  const byCat: Record<string, number> = {};
  const byState: Record<EvidenceState, number> = {
    explicit: 0,
    inferred: 0,
    unknown: 0,
  };
  let pending = 0;
  let pendingValidation = 0;
  for (const c of cases.value) {
    byCat[c.category] = (byCat[c.category] ?? 0) + 1;
    if (evidenceNeedsRecheck(c.evidence)) pendingValidation++;
    else byState[overallOf(c)]++;
    if (assessmentOf(c).verdict === "unreviewed") pending++;
  }
  return {
    total: cases.value.length,
    byCat,
    byState,
    pending,
    pendingValidation,
  };
});

const gapRows = computed(() => {
  const byText = new Map<
    string,
    { text: string; caseIds: string[]; reqIds: string[] }
  >();
  const keyOf = (text: string) => {
    if (/订单编号/.test(text) && /(长度|最大值|最小值)/.test(text))
      return "order-id-length";
    if (/pagesize/i.test(text)) return "page-size-range";
    if (/订单金额/.test(text)) return "order-amount-range";
    return text.replace(/[\s，。；、]/g, "").toLowerCase();
  };
  for (const c of cases.value)
    for (const text of c.assumptions ?? []) {
      const key = keyOf(text);
      const gap = byText.get(key) ?? { text, caseIds: [], reqIds: [] };
      if (!gap.caseIds.includes(c.id)) gap.caseIds.push(c.id);
      for (const e of c.evidence)
        if (!gap.reqIds.includes(e.reqId)) gap.reqIds.push(e.reqId);
      byText.set(key, gap);
    }
  for (const text of assumptions.value)
    if (!byText.has(keyOf(text)))
      byText.set(keyOf(text), { text, caseIds: [], reqIds: [] });
  return [...byText.values()];
});

const duplicateCaseCount = computed(
  () => new Set(duplicates.value.flatMap((d) => d.caseIds)).size,
);

const filtered = computed(() =>
  cases.value.filter((c) => {
    if (filterCategory.value !== "all" && c.category !== filterCategory.value)
      return false;
    if (filterState.value !== "all" && overallOf(c) !== filterState.value)
      return false;
    if (
      filterVerdict.value !== "all" &&
      assessmentOf(c).verdict !== filterVerdict.value
    )
      return false;
    const k = keyword.value.trim().toLowerCase();
    if (k && !`${c.title} ${c.module} ${c.title}`.toLowerCase().includes(k))
      return false;
    return true;
  }),
);

const canGenerate = computed(
  () =>
    Boolean(currentRequirementId.value) &&
    confirmedPoints.value.length > 0 &&
    !generating.value &&
    !recheckingAll.value,
);

async function generate(overwrite: boolean) {
  if (!currentRequirementId.value || !canGenerate.value) return;
  if (!selected.value.length) {
    message.warning("至少选择一个场景类型");
    return;
  }
  if (overwrite) {
    dialog.warning({
      title: "重新生成",
      content: "按已确认测试点生成并复核，全部批次成功后才替换已有用例；失败会保留原有用例。",
      positiveText: "生成并替换",
      negativeText: "取消",
      onPositiveClick: () => runGenerate(true),
    });
    return;
  }
  await runGenerate(false);
}

async function runGenerate(overwrite: boolean) {
  if (!currentRequirementId.value) return;
  const requirementId = currentRequirementId.value;
  let receivedCase = false;
  let completed = false;
  let reportedError = false;
  generating.value = true;
  assumptions.value = [];
  progress.value = { done: 0, total: 0, message: '连接模型…' };
  try {
    await streamGenerate({ requirementId, categories: selected.value, overwrite }, evt => {
      if (currentRequirementId.value !== requirementId) return;
      if (evt.runId) historyRunId.value = evt.runId;
      if (evt.type === 'progress') progress.value = { done: evt.done ?? 0, total: evt.total ?? 0, message: evt.message ?? '' };
      else if (evt.type === 'case' && evt.data) {
        if (overwrite && !receivedCase) cases.value = [];
        receivedCase = true;
        cases.value.push(evt.data);
      } else if (evt.type === 'assumption') assumptions.value = evt.items ?? [];
      else if (evt.type === 'done') {
        completed = true;
        const summary = evt.summary;
        const warning = summary?.unverified ? '，其中 ' + summary.unverified + ' 条依据不足，需人工核对' : '';
        if (summary?.errors) message.warning('部分完成：保存 ' + summary.total + ' 条，' + summary.errors + ' 批失败，请查看流程追溯' + warning);
        else message.success('生成完成：保存 ' + (summary?.total ?? 0) + ' 条用例' + warning);
      } else if (evt.type === 'error') {
        reportedError = true;
        message.error(evt.message ?? '生成失败');
      }
    });
    if (!completed && !reportedError && currentRequirementId.value === requirementId) message.warning('生成连接已结束但未收到完成结果，请查看流程追溯并刷新列表');
  } catch (error) { message.error((error as Error).message); }
  finally {
    generating.value = false;
    progress.value = { done: 0, total: 0, message: '' };
    bumpCases();
    if (currentRequirementId.value === requirementId) await loadCases();
  }
}

async function patchCase(c: TestCase, patch: Partial<TestCase>) {
  try {
    const updated = await api.updateCase(c.id, patch);
    Object.assign(c, updated);
    bumpCases();
  } catch (e) {
    message.error((e as Error).message);
  }
}

/** 人工评审保存：独立于用例内容，改评审不会误存标题/步骤草稿 */
async function assessCase(
  c: TestCase,
  patch: Partial<Assessment>,
): Promise<boolean> {
  const payload = reviewerName.value.trim()
    ? { reviewer: reviewerName.value.trim(), ...patch }
    : patch;
  try {
    const updated = await api.assessCase(c.id, payload);
    Object.assign(c, updated);
    bumpCases();
    return true;
  } catch (e) {
    message.error((e as Error).message);
    return false;
  }
}

const assessDraft = ref<Assessment | null>(null);
const assessBox = ref<HTMLElement | null>(null);
const savingAssessment = ref(false);

function scrollToAssessment() {
  assessBox.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveAssessment() {
  if (!editing.value || !assessDraft.value) return;
  const d = assessDraft.value;
  savingAssessment.value = true;
  const ok = await assessCase(editing.value, {
    verdict: d.verdict,
    reviewer: d.reviewer,
    comment: d.comment,
    revisionCost: d.revisionCost,
  });
  if (ok) {
    if (d.reviewer.trim()) reviewerName.value = d.reviewer.trim();
    assessDraft.value = { ...assessmentOf(editing.value) };
    message.success("人工评审已保存");
  }
  savingAssessment.value = false;
}

// ── 编辑抽屉 ──
interface Draft {
  title: string;
  category: Category;
  priority: Priority;
  module: string;
  precondition: string;
  stepsText: string;
  expectedText: string;
  assumptionsText: string;
  businessConfirmation: string;
  businessConfirmer: string;
  evidence: Evidence[];
}

const editing = ref<TestCase | null>(null);
const draft = ref<Draft | null>(null);
const saving = ref(false);

function openEditor(c: TestCase) {
  editing.value = c;
  draft.value = {
    title: c.title,
    category: c.category,
    priority: c.priority,
    module: c.module,
    precondition: c.precondition,
    stepsText: c.steps.join("\n"),
    expectedText: c.expected.join("\n"),
    assumptionsText: (c.assumptions ?? []).join("\n"),
    businessConfirmation: c.businessConfirmation ?? "",
    businessConfirmer: c.businessConfirmer ?? "",
    evidence: c.evidence.map((e) => ({ ...e })),
  };
  assessDraft.value = { ...assessmentOf(c) };
}

async function saveDraft() {
  if (!editing.value || !draft.value) return;
  const d = draft.value;
  saving.value = true;
  try {
    const updated = await api.updateCase(editing.value.id, {
      title: d.title,
      category: d.category,
      priority: d.priority,
      module: d.module,
      precondition: d.precondition,
      steps: d.stepsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      expected: d.expectedText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      assumptions: d.assumptionsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      businessConfirmation: d.businessConfirmation,
      businessConfirmer: d.businessConfirmer,
      evidence: d.evidence.map((e) => ({ reqId: e.reqId, quote: e.quote })),
    });
    Object.assign(editing.value, updated);
    editing.value = null;
    bumpCases();
    message.success("已保存，依据已重新校验");
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

function chunkTextOf(reqId: string): string {
  return (
    currentRequirement.value?.chunks.find((c) => c.reqId === reqId)?.text ??
    "（当前需求版本中无此条款）"
  );
}

async function addCase() {
  if (!currentRequirementId.value) {
    message.warning("请先选择需求版本");
    return;
  }
  try {
    const created = await api.createCase(currentRequirementId.value, {
      title: "新用例",
      category: "normal",
      priority: "P1",
      steps: [""],
      expected: [""],
    });
    cases.value.push(created);
    bumpCases();
    openEditor(created);
  } catch (e) {
    message.error((e as Error).message);
  }
}

function removeCase(c: TestCase) {
  dialog.warning({
    title: "删除用例",
    content: `确认删除「${c.title}」？`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await api.deleteCase(c.id);
        cases.value = cases.value.filter((x) => x.id !== c.id);
        bumpCases();
      } catch (e) {
        message.error((e as Error).message);
      }
    },
  });
}

async function recheck(c: TestCase) {
  try {
    const updated = await api.recheckCase(c.id);
    Object.assign(c, updated);
    bumpCases();
    message.success("依据已重新校验");
  } catch (e) {
    message.error((e as Error).message);
  }
}

async function recheckAll() {
  if (recheckingAll.value || generating.value) return;
  recheckingAll.value = true;
  recheckedCount.value = 0;
  let failed = 0;
  try {
    for (let i = 0; i < cases.value.length; i += 3) {
      await Promise.all(
        cases.value.slice(i, i + 3).map(async (c) => {
          try {
            Object.assign(c, await api.recheckCase(c.id));
            recheckedCount.value++;
          } catch {
            failed++;
          }
        }),
      );
    }
    bumpCases();
    if (failed)
      message.warning(
        `已重新校验 ${recheckedCount.value} 条，${failed} 条失败，请稍后重试`,
      );
    else message.success(`已重新校验 ${recheckedCount.value} 条依据`);
  } finally {
    recheckingAll.value = false;
  }
}

function exportAs(format: "xlsx" | "csv") {
  if (!currentRequirementId.value) return;
  const url = `/api/requirements/${currentRequirementId.value}/export?format=${format}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
</script>

<template>
  <div class="page cases-page">
    <div v-if="!currentRequirementId" class="empty">
      请先在「需求管理」页导入并选择需求版本，再回来生成用例
    </div>

    <template v-else>
      <!-- 生成控制 -->
      <div class="panel gen-bar">
        <div class="gen-left">
          <span class="section-title" style="margin: 0">生成场景</span>
          <n-checkbox-group v-model:value="selected">
            <n-checkbox
              v-for="c in ALL"
              :key="c"
              :value="c"
              :label="CATEGORY_LABEL[c]"
            />
          </n-checkbox-group>
          <span v-if="estimate" class="tiny-text text-dim">
            {{ estimate.points }} 个已确认测试点 · {{ estimate.batches }} 批生成（另含依据复核）
          </span>
        </div>
        <div class="gen-right">
          <n-button
            size="small"
            :disabled="!canGenerate"
            :loading="generating"
            type="primary"
            @click="generate(false)"
          >
            生成用例
          </n-button>
          <n-button
            size="small"
            :disabled="!canGenerate"
            @click="generate(true)"
            >重新生成</n-button
          >
        </div>
      </div>

      <div class="generation-basis">
        仅按所选场景中已确认的 {{ confirmedPoints.length }} 个测试点生成，其中 {{ linkedPointCount }} 个已有来源关联的用例；此数量不代表验证通过或完整覆盖。
        <span v-if="!confirmedPoints.length">请先在「需求管理」核对并确认测试点。</span>
        <span v-if="estimate">待确认 {{ estimate.pending }} 个、已排除 {{ estimate.excluded }} 个，本次不参与生成。</span>
      </div>
      <details v-if="pointLinks.length" class="point-matrix panel">
        <summary>查看已确认测试点与用例对应（{{ linkedPointCount }} / {{ confirmedPoints.length }} 个有来源关联）</summary>
        <div v-for="link in pointLinks" :key="link.point.id" class="point-link">
          <div>
            <strong>{{ link.point.title }}</strong>
            <div>{{ link.point.objective }}</div>
            <details><summary>查看引用原文</summary><blockquote v-for="(e, index) in link.point.evidence" :key="index">{{ e.reqId }}：{{ e.quote }}</blockquote></details>
          </div>
          <div class="point-cases">
            <span v-if="!link.cases.length" class="text-dim">尚无来源关联的用例</span>
            <n-button v-for="c in link.cases" :key="c.id" size="tiny" text type="primary" @click="openEditor(c)">{{ c.title }}</n-button>
          </div>
        </div>
      </details>
      <!-- 生成进度 -->
      <div v-if="generating" class="panel progress-panel">
        <div class="progress-head">
          <span class="tiny-text">{{ progress.message || "生成中…" }}</span>
          <span class="tiny-text text-dim">
            {{
              progress.total
                ? `${progress.done}/${progress.total} 批完成`
                : "准备中"
            }}
          </span>
        </div>
        <div class="progress-track">
          <div
            class="progress-fill"
            :style="{
              width: progress.total
                ? `${(progress.done / progress.total) * 100}%`
                : '8%',
            }"
          />
        </div>
        <div class="tiny-text text-dim" style="margin-top: 6px">
          候选生成和依据复核完成后保存；处理记录可在「流程追溯」查看。
        </div>
      </div>

      <!-- 统计概览 -->
      <div class="panel overview-panel">
        <div class="stats-row">
          <div class="stat">
            <span class="stat-num">{{ stats.total }}</span>
            <span class="stat-label">用例总数</span>
          </div>
          <div v-for="c in ALL" :key="c" class="stat">
            <span class="stat-num" :style="{ color: CATEGORY_COLOR[c] }">{{
              stats.byCat[c] ?? 0
            }}</span>
            <span class="stat-label">{{ CATEGORY_LABEL[c] }}</span>
          </div>
          <div class="stat">
            <span class="stat-num" :style="{ color: STATE_COLOR.unknown }">{{
              stats.byState.unknown
            }}</span>
            <span class="stat-label">依据未定位</span>
          </div>
          <div v-if="stats.pendingValidation" class="stat">
            <span class="stat-num" style="color: var(--tp-yellow)">{{
              stats.pendingValidation
            }}</span>
            <span class="stat-label">待重新校验</span>
          </div>
          <div class="stat">
            <span class="stat-num" :style="{ color: STATE_COLOR.inferred }">{{
              stats.byState.inferred
            }}</span>
            <span class="stat-label">近似引用</span>
          </div>
          <div class="stat">
            <span class="stat-num" style="color: var(--tp-yellow)">{{
              gapRows.length
            }}</span>
            <span class="stat-label">需求待确认</span>
          </div>
          <div class="stat">
            <span class="stat-num" style="color: var(--tp-yellow)">{{
              duplicateCaseCount
            }}</span>
            <span class="stat-label">近似重复</span>
          </div>
          <div class="stat">
            <span
              class="stat-num"
              :style="{ color: VERDICT_COLOR.unreviewed }"
              >{{ stats.pending }}</span
            >
            <span class="stat-label">待人工评审</span>
          </div>
        </div>

        <div v-if="gapRows.length || duplicates.length" class="quality-notices">
          <details v-if="gapRows.length" class="assumption-box">
            <summary class="assumption-title">
              需求待确认（{{ gapRows.length }}）
            </summary>
            <ul>
              <li v-for="(gap, i) in gapRows" :key="i">
                {{ gap.text }}
                <span v-if="gap.reqIds.length" class="text-dim">
                  · {{ gap.reqIds.join("、") }}</span
                >
                <n-button
                  v-for="id in gap.caseIds.slice(0, 3)"
                  :key="id"
                  size="tiny"
                  text
                  style="margin-left: 6px"
                  @click="
                    cases.find((c) => c.id === id) &&
                    openEditor(cases.find((c) => c.id === id)!)
                  "
                  >查看用例</n-button
                >
              </li>
            </ul>
          </details>
          <details v-if="duplicates.length" class="assumption-box">
            <summary class="assumption-title">
              近似重复（{{ duplicates.length }} 组，需人工判断是否合并）
            </summary>
            <ul>
              <li v-for="(dup, i) in duplicates" :key="i">
                {{ dup.reason }}
                <n-button
                  v-for="id in dup.caseIds"
                  :key="id"
                  size="tiny"
                  text
                  style="margin-left: 6px"
                  @click="
                    cases.find((c) => c.id === id) &&
                    openEditor(cases.find((c) => c.id === id)!)
                  "
                  >{{ cases.find((c) => c.id === id)?.title ?? id }}</n-button
                >
              </li>
            </ul>
          </details>
        </div>
      </div>

      <div class="panel cases-panel">
        <div class="cases-head">
          <div class="list-title">
            <h3 class="section-title">测试用例</h3>
            <n-tag size="tiny" :bordered="false" round>{{
              cases.length
            }}</n-tag>
          </div>
          <div class="case-actions">
            <n-button size="small" quaternary @click="openHistory()">流程追溯</n-button>
            <n-button size="small" secondary @click="addCase"
              >手动新增</n-button
            >
            <n-button
              size="small"
              quaternary
              :disabled="!cases.length || generating"
              :loading="recheckingAll"
              @click="recheckAll"
              >{{
                recheckingAll
                  ? `已校验 ${recheckedCount}/${cases.length}`
                  : "重新校验全部依据"
              }}</n-button
            >
            <n-button
              size="small"
              quaternary
              :disabled="!cases.length"
              @click="exportAs('xlsx')"
              >导出 Excel</n-button
            >
            <n-button
              size="small"
              quaternary
              :disabled="!cases.length"
              @click="exportAs('csv')"
              >导出 CSV</n-button
            >
          </div>
        </div>

        <div class="filters">
          <n-select
            v-model:value="filterCategory"
            :options="categoryOptions"
            aria-label="按用例分类筛选"
            size="small"
          />
          <n-select
            v-model:value="filterState"
            :options="stateOptions"
            aria-label="按需求依据筛选"
            size="small"
          />
          <n-select
            v-model:value="filterVerdict"
            :options="verdictOptions"
            aria-label="按人工结论筛选"
            size="small"
          />
          <n-input
            v-model:value="keyword"
            size="small"
            placeholder="搜索标题或模块"
            clearable
          />
          <n-button size="small" quaternary @click="clearFilters"
            >重置</n-button
          >
          <span class="tiny-text text-dim filter-count" role="status"
            >显示 {{ filtered.length }} / {{ cases.length }} 条</span
          >
        </div>

        <n-spin v-if="loading" style="display: block; margin: 40px auto" />

        <div v-else-if="!cases.length" class="empty">
          还没有用例。选择场景类型后点「生成用例」，或手动新增
        </div>

        <div v-else-if="!filtered.length" class="empty">
          <div>没有符合当前筛选条件的用例</div>
          <n-button size="small" text type="primary" @click="clearFilters"
            >清空筛选</n-button
          >
        </div>

        <div
          v-else
          class="table-scroll"
          role="region"
          aria-label="测试用例列表"
          tabindex="0"
        >
          <table class="case-table">
            <colgroup>
              <col style="width: 72px" />
              <col />
              <col style="width: 80px" />
              <col style="width: 150px" />
              <col style="width: 150px" />
              <col style="width: 120px" />
              <col style="width: 90px" />
              <col style="width: 108px" />
            </colgroup>
            <thead>
              <tr>
                <th>分类</th>
                <th>用例标题</th>
                <th>优先级</th>
                <th>模块</th>
                <th>需求依据</th>
                <th>人工结论</th>
                <th>修改成本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in filtered"
                :key="c.id"
                :class="{ risk: overallOf(c) === 'unknown' }"
              >
                <td>
                  <span
                    class="cat-tag"
                    :style="{
                      color: CATEGORY_COLOR[c.category],
                      borderColor: CATEGORY_COLOR[c.category],
                    }"
                  >
                    {{ CATEGORY_LABEL[c.category] }}
                  </span>
                </td>
                <td>
                  <input
                    class="cell-input"
                    :value="c.title"
                    :title="c.title"
                    :aria-label="`用例标题：${c.title}`"
                    @change="
                      patchCase(c, {
                        title: ($event.target as HTMLInputElement).value,
                      })
                    "
                  />
                </td>
                <td>
                  <select
                    :value="c.priority"
                    class="cell-select"
                    :aria-label="`${c.title}的优先级`"
                    @change="
                      patchCase(c, {
                        priority: ($event.target as HTMLSelectElement)
                          .value as Priority,
                      })
                    "
                  >
                    <option
                      v-for="p in priorityOptions"
                      :key="p.value"
                      :value="p.value"
                    >
                      {{ p.label }}
                    </option>
                  </select>
                </td>
                <td class="text-dim tiny-text module-cell" :title="c.module">
                  {{ c.module || "—" }}
                </td>
                <td><EvidenceBadge :evidence="c.evidence" /></td>
                <td>
                  <select
                    class="cell-select"
                    :value="assessmentOf(c).verdict"
                    :aria-label="`${c.title}的人工结论`"
                    :style="{ color: VERDICT_COLOR[assessmentOf(c).verdict] }"
                    @change="
                      assessCase(c, {
                        verdict: ($event.target as HTMLSelectElement)
                          .value as Verdict,
                      })
                    "
                  >
                    <option
                      v-for="v in verdictSelectOptions"
                      :key="v.value"
                      :value="v.value"
                    >
                      {{ v.label }}
                    </option>
                  </select>
                </td>
                <td>
                  <select
                    class="cell-select"
                    :value="assessmentOf(c).revisionCost"
                    :aria-label="`${c.title}的修改成本`"
                    :disabled="assessmentOf(c).verdict !== 'needs_revision'"
                    :style="{ color: COST_COLOR[assessmentOf(c).revisionCost] }"
                    @change="
                      assessCase(c, {
                        revisionCost: ($event.target as HTMLSelectElement)
                          .value as RevisionCost,
                      })
                    "
                  >
                    <option
                      v-for="o in costSelectOptions"
                      :key="o.value"
                      :value="o.value"
                    >
                      {{ o.label }}
                    </option>
                  </select>
                </td>
                <td>
                  <div class="ops">
                    <n-button size="tiny" quaternary @click="openEditor(c)"
                      >编辑</n-button
                    >
                    <n-button
                      size="tiny"
                      quaternary
                      type="error"
                      @click="removeCase(c)"
                      >删除</n-button
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 编辑抽屉 -->
    <n-drawer
      :show="Boolean(editing)"
      :width="660"
      style="max-width: 100vw"
      @update:show="editing = null"
    >
      <n-drawer-content v-if="draft && editing" title="编辑用例" closable>
        <div class="source-box">
          <template v-if="editing.source">
            <strong>来源测试点：{{ editing.source.title }}</strong>
            <div>{{ editing.source.objective }}</div>
            <div class="tiny-text text-dim">{{ editing.source.reqIds.join('、') }} · {{ editing.source.pointId }}</div>
            <div v-if="editing.source.analysisId !== currentRequirement?.analysis?.id || editing.source.analysisUpdatedAt !== currentRequirement?.analysis?.updatedAt">生成后需求分析已有变化，请对照当时快照重新核对。</div>
            <n-button size="small" text type="primary" @click="openHistory(editing.source!.runId, editing.id)">查看生成与修改记录</n-button>
          </template>
          <template v-else>
            <div>此用例没有已确认测试点的生成来源，可能为历史数据、手动新增或版本对比建议。不会补造关联。</div>
            <n-button size="small" text type="primary" @click="openHistory('', editing.id)">查看已有操作记录</n-button>
          </template>
        </div>
        <div class="form">
          <label>标题</label>
          <n-input v-model:value="draft.title" size="small" />

          <div class="form-row">
            <div class="form-col">
              <label>分类</label>
              <n-select
                v-model:value="draft.category"
                :options="
                  ALL.map((c) => ({ label: CATEGORY_LABEL[c], value: c }))
                "
                size="small"
              />
            </div>
            <div class="form-col">
              <label>优先级</label>
              <n-select
                v-model:value="draft.priority"
                :options="priorityOptions"
                size="small"
              />
            </div>
            <div class="form-col">
              <label>模块</label>
              <n-input v-model:value="draft.module" size="small" />
            </div>
          </div>

          <label>前置条件</label>
          <n-input
            v-model:value="draft.precondition"
            type="textarea"
            :autosize="{ minRows: 2 }"
            size="small"
          />

          <label>测试步骤（一行一步）</label>
          <n-input
            v-model:value="draft.stepsText"
            type="textarea"
            :autosize="{ minRows: 4 }"
            size="small"
          />

          <label>预期结果（一行一条，须可判定）</label>
          <n-input
            v-model:value="draft.expectedText"
            type="textarea"
            :autosize="{ minRows: 4 }"
            size="small"
          />

          <label>假设与待确认（一行一条）</label>
          <n-input
            v-model:value="draft.assumptionsText"
            type="textarea"
            :autosize="{ minRows: 2 }"
            size="small"
          />
          <label>业务确认结果（人工填写，不改变自动依据判断）</label>
          <n-input
            v-model:value="draft.businessConfirmation"
            type="textarea"
            :autosize="{ minRows: 2 }"
            size="small"
            placeholder="逐项记录待确认规则的实际约定"
          />
          <label>业务确认人</label>
          <n-input v-model:value="draft.businessConfirmer" size="small" />

          <label style="display: flex; align-items: center; gap: 8px">
            需求依据
            <span class="tiny-text text-dim"
              >改动引用文本后保存会立即重新校验</span
            >
          </label>

          <div v-for="(e, i) in draft.evidence" :key="i" class="evidence-item">
            <div class="evidence-head">
              <span
                class="mono"
                style="color: var(--tp-accent); font-size: 12px"
                >{{ e.reqId }}</span
              >
              <span
                class="tiny-text"
                :style="{ color: STATE_COLOR[evidenceStateOf([e])] }"
              >
                {{ STATE_LABEL[evidenceStateOf([e])]
                }}<template v-if="e.score">
                  · 原文匹配度 {{ e.score.toFixed(2) }}</template
                >
              </span>
            </div>
            <n-input
              v-model:value="e.quote"
              type="textarea"
              :autosize="{ minRows: 2 }"
              size="small"
            />
            <div
              class="tiny-text"
              :style="{ color: STATE_COLOR[evidenceStateOf([e])] }"
            >
              {{ e.reason }}
            </div>
            <div class="tiny-text text-dim">
              测试条件：{{ STATE_LABEL[e.conditionSupport ?? "unknown"] }} ·
              预期结果：{{ STATE_LABEL[e.expectedSupport ?? "unknown"] }}
            </div>
            <div v-if="e.sectionPath" class="tiny-text text-dim">
              原文位置：{{ e.sectionPath }}
            </div>
            <div v-if="e.relocated" class="relocate">
              原文相近句：{{ e.relocated }}
            </div>
            <details class="origin">
              <summary class="tiny-text text-dim">查看该条款原文</summary>
              <div class="origin-text">{{ chunkTextOf(e.reqId) }}</div>
            </details>
          </div>

          <div
            v-if="!draft.evidence.length"
            class="tiny-text"
            style="color: var(--tp-red)"
          >
            这条用例没有引用任何需求条款，无法追溯依据
          </div>
        </div>

        <section v-if="assessDraft" ref="assessBox" class="assess-box">
          <div class="assess-head">
            <span class="section-title" style="margin: 0">人工评审</span>
            <span class="tiny-text text-dim"
              >测试 / 业务人员填写，独立保存，不参与系统自动评分</span
            >
          </div>
          <div class="form-row">
            <div class="form-col">
              <label>有效性结论</label>
              <n-select
                v-model:value="assessDraft.verdict"
                :options="verdictSelectOptions"
                size="small"
              />
            </div>
            <div class="form-col">
              <label>修改成本</label>
              <n-select
                v-model:value="assessDraft.revisionCost"
                :options="costSelectOptions"
                :disabled="assessDraft.verdict !== 'needs_revision'"
                size="small"
              />
            </div>
            <div class="form-col">
              <label>评审人</label>
              <n-input
                v-model:value="assessDraft.reviewer"
                size="small"
                placeholder="姓名"
              />
            </div>
          </div>
          <label>批注 / 发现的遗漏</label>
          <n-input
            v-model:value="assessDraft.comment"
            type="textarea"
            :autosize="{ minRows: 2 }"
            size="small"
            placeholder="例如：预期结果不可判定；2.1 条款缺 21 位越界用例"
          />
          <div class="assess-foot">
            <span class="tiny-text text-dim">
              {{
                assessDraft.reviewedAt
                  ? `上次评审 ${new Date(assessDraft.reviewedAt).toLocaleString("zh-CN")}`
                  : "尚未评审"
              }}
              · 成本刻度 低 1 / 中 3 / 高 6 点（相对工作量，非工时）
            </span>
            <n-button
              size="small"
              type="primary"
              :loading="savingAssessment"
              @click="saveAssessment"
            >
              保存评审
            </n-button>
          </div>
        </section>

        <template #footer>
          <div class="drawer-actions">
            <n-button size="small" @click="editing = null">取消</n-button>
            <n-button size="small" quaternary @click="scrollToAssessment"
              >填写人工评审</n-button
            >
            <n-button size="small" @click="editing && recheck(editing)"
              >重新校验依据</n-button
            >
            <n-button
              size="small"
              type="primary"
              :loading="saving"
              @click="saveDraft"
              >保存</n-button
            >
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
    <workflow-history v-if="currentRequirementId" v-model:show="showHistory" :requirement-id="currentRequirementId" :run-id="historyRunId" :case-id="historyCaseId" />
  </div>
</template>

<style scoped>
.point-matrix { margin-bottom: 14px; font-size: 12px; }
.point-matrix summary { cursor: pointer; color: var(--tp-accent); }
.point-link { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; padding: 12px 0; border-top: 1px solid var(--tp-border); margin-top: 10px; overflow-wrap: anywhere; line-height: 1.8; }
.point-link blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--tp-border); }
.point-cases { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.point-cases :deep(.n-button) { max-width: 100%; height: auto; white-space: normal; text-align: left; }
@media (max-width: 700px) { .point-link { grid-template-columns: minmax(0, 1fr); } }
.generation-basis { margin: 10px 0 14px; color: var(--tp-text-dim); font-size: 12px; line-height: 1.8; }
.generation-basis span { margin-left: 8px; }
.source-box { display: flex; flex-direction: column; gap: 8px; padding: 12px; margin-bottom: 14px; background: var(--tp-panel-2); border: 1px solid var(--tp-border); border-radius: 6px; overflow-wrap: anywhere; font-size: 12px; }
.cases-page {
  min-width: 0;
}

.gen-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 18px;
}

.gen-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  min-width: 0;
}

.gen-right,
.case-actions,
.drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cases-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.list-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.list-title .section-title {
  margin: 0;
}

.drawer-actions {
  justify-content: flex-end;
  width: 100%;
}

.tiny-text {
  font-size: 12px;
}

.progress-panel {
  padding: 12px 18px;
}

.progress-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.progress-track {
  height: 4px;
  background: var(--tp-panel-2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--tp-accent);
  transition: width 0.3s;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 12px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: 5px;
  background: var(--tp-panel-2);
}

.stat-num {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
}

.stat-label {
  font-size: 11px;
  color: var(--tp-text-dim);
}

.assumption-box {
  background: rgba(226, 185, 59, 0.08);
  border: 1px solid rgba(226, 185, 59, 0.25);
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 0;
}

.quality-notices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  align-items: start;
  gap: 12px;
  margin-top: 14px;
}

.assumption-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--tp-yellow);
  cursor: pointer;
}

.assumption-box[open] .assumption-title {
  margin-bottom: 8px;
}

.assumption-box ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--tp-text);
  max-height: 220px;
  overflow: auto;
  overflow-wrap: anywhere;
}

.filters {
  display: grid;
  grid-template-columns: 120px 140px 150px minmax(180px, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.filter-count {
  white-space: nowrap;
}

.table-scroll {
  max-height: min(65vh, 720px);
  overflow: auto;
  border: 1px solid var(--tp-border);
  border-radius: 5px;
}

.case-table {
  width: 100%;
  min-width: 1160px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.case-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--tp-panel-2);
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--tp-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 8px 10px;
  border-bottom: 1px solid var(--tp-border);
}

.case-table td {
  padding: 10px;
  border-bottom: 1px solid var(--tp-border);
  font-size: 13px;
  vertical-align: middle;
}

.case-table tbody tr:last-child td {
  border-bottom: 0;
}

.case-table tbody tr:hover {
  background: var(--tp-panel-2);
}

.case-table tr.risk {
  background: rgba(239, 95, 95, 0.06);
}

.case-table tr.risk:hover {
  background: rgba(239, 95, 95, 0.1);
}

.cat-tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 7px;
  border: 1px solid;
  border-radius: 4px;
  line-height: 1.6;
}

.cell-input {
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--tp-text);
  font-size: 13px;
  padding: 3px 6px;
  outline: none;
  font-family: inherit;
  text-overflow: ellipsis;
}

.cell-input:hover {
  border-color: var(--tp-border);
}

.cell-input:focus {
  border-color: var(--tp-accent);
  background: var(--tp-panel-2);
}

.cell-select {
  background: transparent;
  border: 1px solid transparent;
  color: var(--tp-text);
  font-size: 12px;
  border-radius: 4px;
  padding: 3px 4px;
  outline: none;
  width: 100%;
  cursor: pointer;
}

.cell-select:hover {
  border-color: var(--tp-border);
}

.cell-select:focus-visible {
  outline: 2px solid var(--tp-accent);
  outline-offset: 1px;
}

.ops {
  display: flex;
  gap: 2px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form label {
  font-size: 12px;
  color: var(--tp-text-dim);
  margin-top: 8px;
}

.form-row {
  display: flex;
  gap: 10px;
}

.form-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.evidence-item {
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.evidence-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.relocate {
  font-size: 12px;
  color: var(--tp-yellow);
  background: rgba(226, 185, 59, 0.08);
  padding: 6px 8px;
  border-radius: 4px;
}

.origin {
  margin-top: 2px;
}

.origin summary {
  cursor: pointer;
  font-size: 12px;
}

.origin-text {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--tp-text-dim);
  white-space: pre-wrap;
  max-height: 180px;
  overflow: auto;
  background: var(--tp-panel-2);
  padding: 8px 10px;
  border-radius: 4px;
}

.cell-select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.module-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assess-box {
  margin-top: 18px;
  border: 1px solid var(--tp-border);
  border-left: 3px solid var(--tp-purple);
  border-radius: 6px;
  padding: 12px 14px 14px;
  background: var(--tp-panel-2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.assess-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 4px;
}

.assess-box label {
  font-size: 12px;
  color: var(--tp-text-dim);
  margin-top: 6px;
}

.assess-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

@media (max-width: 1200px) {
  .filters {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .gen-bar,
  .overview-panel,
  .cases-panel {
    padding: 12px;
  }

  .gen-left {
    gap: 10px;
  }

  .gen-right {
    width: 100%;
  }

  .filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-row,
  .assess-head,
  .assess-foot {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
