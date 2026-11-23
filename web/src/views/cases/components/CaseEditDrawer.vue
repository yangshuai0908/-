<script setup lang="ts">
import { ref, watch } from "vue";
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NInput,
  NSelect,
  useMessage,
} from "naive-ui";
import { api, type AgentRole } from "../../../api/client";
import {
  bumpCases,
  currentRequirement,
} from "../../../stores/workspace";
import {
  AGENT_ROLES,
  CATEGORY_LABEL,
  COST_LABEL,
  SCENARIO_KIND_LABEL,
  STATE_COLOR,
  STATE_LABEL,
  VERDICT_LABEL,
  assessmentOf,
  evidenceStateOf,
  type Assessment,
  type Category,
  type Evidence,
  type Priority,
  type RevisionCost,
  type TestCase,
  type Verdict,
} from "../../../types";

const props = defineProps<{
  caseItem: TestCase | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "dispatch-to-role", c: TestCase, role: AgentRole): void;
}>();

const message = useMessage();

const ALL: Category[] = ["normal", "abnormal", "boundary", "permission"];
const priorityOptions: { label: string; value: Priority }[] = [
  { label: "P0", value: "P0" },
  { label: "P1", value: "P1" },
  { label: "P2", value: "P2" },
];

const VERDICTS: Verdict[] = [
  "unreviewed",
  "effective",
  "needs_revision",
  "invalid",
];
const COSTS: RevisionCost[] = ["none", "low", "medium", "high"];

const verdictSelectOptions = VERDICTS.map((v) => ({
  label: VERDICT_LABEL[v],
  value: v,
}));
const costSelectOptions = COSTS.map((c) => ({
  label: COST_LABEL[c],
  value: c,
}));

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

const draft = ref<Draft | null>(null);
const saving = ref(false);
const assessDraft = ref<Assessment | null>(null);
const assessBox = ref<HTMLElement | null>(null);
const savingAssessment = ref(false);

const reviewerName = ref(localStorage.getItem("tp.reviewer") ?? "");
watch(reviewerName, (v) => localStorage.setItem("tp.reviewer", v.trim()));

watch(
  () => props.caseItem,
  (c) => {
    if (!c) {
      draft.value = null;
      assessDraft.value = null;
      return;
    }
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
  },
  { immediate: true },
);

function chunkTextOf(reqId: string): string {
  return (
    currentRequirement.value?.chunks.find((c) => c.reqId === reqId)?.text ??
    "（当前需求版本中无此条款）"
  );
}

function scrollToAssessment() {
  assessBox.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

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

async function saveAssessment() {
  if (!props.caseItem || !assessDraft.value) return;
  const d = assessDraft.value;
  savingAssessment.value = true;
  const ok = await assessCase(props.caseItem, {
    verdict: d.verdict,
    reviewer: d.reviewer,
    comment: d.comment,
    revisionCost: d.revisionCost,
  });
  if (ok) {
    if (d.reviewer.trim()) reviewerName.value = d.reviewer.trim();
    assessDraft.value = { ...assessmentOf(props.caseItem) };
    message.success("人工评审已保存");
  }
  savingAssessment.value = false;
}

async function saveDraft() {
  if (!props.caseItem || !draft.value) return;
  const d = draft.value;
  saving.value = true;
  try {
    const updated = await api.updateCase(props.caseItem.id, {
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
    Object.assign(props.caseItem, updated);
    bumpCases();
    message.success("已保存，依据已重新校验");
    emit("close");
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    saving.value = false;
  }
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
</script>

<template>
  <n-drawer
    :show="Boolean(props.caseItem)"
    :width="660"
    style="max-width: 100vw"
    @update:show="emit('close')"
  >
    <n-drawer-content v-if="draft && props.caseItem" title="编辑用例" closable>
      <div class="drawer-agent-bar">
        <button
          type="button"
          class="drawer-agent-btn reviewer"
          :title="AGENT_ROLES.reviewer.label + '：检查用例并给出建议，不修改内容'"
          @click="emit('dispatch-to-role', props.caseItem, 'reviewer')"
        >
          检查用例
        </button>
        <button
          type="button"
          class="drawer-agent-btn qa"
          :title="AGENT_ROLES.qa_expert.label + '：按原文依据优化当前用例并保存'"
          @click="emit('dispatch-to-role', props.caseItem, 'qa_expert')"
        >
          优化用例
        </button>
      </div>

      <div class="source-box">
        <template v-if="props.caseItem.source">
          <strong>来源测试点：{{ props.caseItem.source.title }}</strong>
          <div>{{ props.caseItem.source.objective }}</div>
          <div v-if="props.caseItem.source.scenarioKind" class="tiny-text">
            场景骨架：{{ SCENARIO_KIND_LABEL[props.caseItem.source.scenarioKind] ?? props.caseItem.source.scenarioKind }}（由规则确定性展开，结构不随模型措辞变化）
          </div>
          <div class="tiny-text text-dim">
            {{ props.caseItem.source.reqIds.join("、") }} ·
            {{ props.caseItem.source.pointId }}
          </div>
          <div
            v-if="
              props.caseItem.source.analysisId !==
                currentRequirement?.analysis?.id ||
              props.caseItem.source.analysisUpdatedAt !==
                currentRequirement?.analysis?.updatedAt
            "
          >
            生成后需求分析已有变化，请对照当时快照重新核对。
          </div>
        </template>
        <template v-else>
          <div>
            此用例没有已确认测试点的生成来源，可能为历史数据、手动新增或版本对比建议。不会补造关联。
          </div>
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
              :options="ALL.map((c) => ({ label: CATEGORY_LABEL[c], value: c }))"
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
          <span class="tiny-text text-dim">改动引用文本后保存会立即重新校验</span>
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
              {{ STATE_LABEL[evidenceStateOf([e])] }}
              <template v-if="e.score">
                · 原文匹配度 {{ e.score.toFixed(2) }}
              </template>
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
          <span class="tiny-text text-dim">
            测试 / 业务人员填写，独立保存，不参与系统自动评分
          </span>
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
          <n-button size="small" @click="emit('close')">取消</n-button>
          <n-button size="small" quaternary @click="scrollToAssessment"
            >填写人工评审</n-button
          >
          <n-button size="small" @click="props.caseItem && recheck(props.caseItem)"
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
</template>

<style scoped>
.source-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  margin-bottom: 14px;
  background: var(--tp-panel-2);
  border: 1px solid var(--tp-border);
  border-radius: 6px;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  width: 100%;
}
.tiny-text {
  font-size: 12px;
}
.drawer-agent-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  margin-bottom: 12px;
}
.drawer-agent-tip {
  font-size: 11.5px;
  font-weight: 600;
  color: #1e40af;
  flex-shrink: 0;
}
.drawer-agent-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  background: #ffffff;
  border: 1px solid #cbd5e1;
}
.drawer-agent-btn.reviewer {
  color: #15803d;
  border-color: #86efac;
}
.drawer-agent-btn.reviewer:hover {
  background: #f0fdf4;
  border-color: #22c55e;
}
.drawer-agent-btn.qa {
  color: #c2410c;
  border-color: #fdba74;
}
.drawer-agent-btn.qa:hover {
  background: #fff7ed;
  border-color: #f97316;
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
@media (max-width: 600px) {
  .form-row,
  .assess-head,
  .assess-foot {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
