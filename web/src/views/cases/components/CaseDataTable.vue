<script setup lang="ts">
import { ref } from "vue";
import { NButton, NTag, NSpin } from "naive-ui";
import EvidenceBadge from "../../../components/EvidenceBadge.vue";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  COST_COLOR,
  VERDICT_COLOR,
  assessmentOf,
  evidenceStateOf,
  type Category,
  type EvidenceState,
  type Priority,
  type RevisionCost,
  type TestCase,
  type Verdict,
} from "../../../types";
import {
  cases,
  canvasFocus,
  highlightedCaseId,
} from "../../../stores/workspace";

// ── props / emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  filtered: TestCase[];
  loading: boolean;
  selectedCaseIds: Set<string>;
  isAllSelected: boolean;
  recheckingAll: boolean;
  recheckedCount: number;
  generating: boolean;
}>();

const emit = defineEmits<{
  (e: "open-editor", c: TestCase): void;
  (e: "remove-case", c: TestCase): void;
  (e: "row-select", c: TestCase): void;
  (e: "toggle-select-all"): void;
  (e: "toggle-select-case", id: string): void;
  (e: "clear-selection"): void;
  (e: "patch-case", c: TestCase, patch: Partial<TestCase>): void;
  (e: "assess-case", c: TestCase, patch: { verdict?: Verdict; revisionCost?: RevisionCost }): void;
  (e: "dispatch-to-role", c: TestCase, role: "reviewer" | "qa_expert"): void;
  (e: "review-library"): void;
  (e: "add-case"): void;
  (e: "recheck-all"): void;
  (e: "export-as", format: "xlsx" | "csv"): void;
  (e: "ask-review-selection"): void;
}>();

const ALL: Category[] = ["normal", "abnormal", "boundary", "permission"];

const priorityOptions: { label: string; value: Priority }[] = [
  { label: "P0", value: "P0" },
  { label: "P1", value: "P1" },
  { label: "P2", value: "P2" },
];

const VERDICTS: Verdict[] = ["unreviewed", "effective", "needs_revision", "invalid"];
const COSTS: RevisionCost[] = ["none", "low", "medium", "high"];

const verdictSelectOptions = VERDICTS.map((v) => ({
  label: (
    { unreviewed: "待评审", effective: "有效", needs_revision: "需修改", invalid: "无效" } as Record<Verdict, string>
  )[v],
  value: v,
}));
const costSelectOptions = COSTS.map((c) => ({
  label: (
    { none: "无", low: "低", medium: "中", high: "高" } as Record<RevisionCost, string>
  )[c],
  value: c,
}));

function overallOf(c: TestCase): EvidenceState {
  return evidenceStateOf(c.evidence);
}

const expandedCaseIds = ref<Set<string>>(new Set());

function toggleExpand(id: string, e?: Event) {
  e?.stopPropagation();
  const next = new Set(expandedCaseIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedCaseIds.value = next;
}

function toggleExpandAll() {
  if (expandedCaseIds.value.size === props.filtered.length) {
    expandedCaseIds.value = new Set();
  } else {
    expandedCaseIds.value = new Set(props.filtered.map((c) => c.id));
  }
}
</script>

<template>
  <div class="panel cases-panel">
    <div class="cases-head">
      <div class="list-title">
        <h3 class="section-title">测试用例</h3>
        <n-tag size="tiny" :bordered="false" round>{{ cases.length }}</n-tag>
      </div>
      <div class="case-actions">
        <n-button size="small" :disabled="!cases.length || generating" title="检查用例质量并保存报告，不修改用例" @click="emit('review-library')">质量检查</n-button>
        <n-button size="small" secondary @click="emit('add-case')">手动新增</n-button>
        <details class="more-tools">
          <summary>更多操作</summary>
          <div class="tool-menu">
            <n-button size="small" quaternary :disabled="!cases.length || generating" :loading="recheckingAll" @click="emit('recheck-all')">{{ recheckingAll ? '已校验 ' + recheckedCount + '/' + cases.length : '重新校验全部依据' }}</n-button>
            <n-button size="small" quaternary :disabled="!cases.length" @click="emit('export-as', 'xlsx')">导出 Excel</n-button>
            <n-button size="small" quaternary :disabled="!cases.length" @click="emit('export-as', 'csv')">导出 CSV</n-button>
            <n-button size="small" quaternary :disabled="!filtered.length" @click="toggleExpandAll">{{ expandedCaseIds.size === filtered.length && filtered.length > 0 ? '收起全部步骤与预期' : '展开全部步骤与预期' }}</n-button>
          </div>
        </details>
      </div>
    </div>

    <!-- Filter bar slot -->
    <slot name="filter-bar" />

    <n-spin v-if="loading" style="display: block; margin: 40px auto" />

    <div v-else-if="!cases.length" class="empty">
      还没有用例。先确认测试点，再由用例设计师生成。
    </div>

    <div v-else-if="!filtered.length" class="empty">
      <div>没有符合当前筛选条件的用例</div>
      <slot name="clear-filter-btn" />
    </div>

    <div
      v-else
      class="table-scroll"
      role="region"
      aria-label="测试用例列表"
      tabindex="0"
    >
      <!-- 批量选择操作栏 -->
      <div v-if="selectedCaseIds.size" class="cases-batch-bar">
        <span class="batch-count"
          >已勾选 <b>{{ selectedCaseIds.size }}</b> 条用例</span
        >
        <div class="batch-actions">
          <button
            type="button"
            class="batch-agent-btn primary"
            @click="emit('ask-review-selection')"
          >
            检查所选
          </button>
          <button
            type="button"
            class="batch-clear-btn"
            @click="emit('clear-selection')"
          >
            取消选择
          </button>
        </div>
      </div>

      <table class="case-table">
        <colgroup>
          <col style="width: 32px" />
          <col style="width: 38px" />
          <col style="width: 64px" />
          <col style="min-width: 200px" />
          <col style="width: 72px" />
          <col style="width: 110px" />
          <col style="width: 120px" />
          <col style="width: 95px" />
          <col style="width: 85px" />
          <col style="width: 210px" />
        </colgroup>
        <thead>
          <tr>
            <th class="th-expand">
              <button
                type="button"
                class="caret-toggle-btn"
                :class="{ open: expandedCaseIds.size === filtered.length && filtered.length > 0 }"
                title="展开/收起全部步骤与预期"
                @click="toggleExpandAll"
              >
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
                  <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </th>
            <th class="th-checkbox">
              <input
                type="checkbox"
                :checked="isAllSelected"
                aria-label="全选用例"
                @change="emit('toggle-select-all')"
              />
            </th>
            <th>分类</th>
            <th>用例标题</th>
            <th>优先级</th>
            <th>模块</th>
            <th>需求依据</th>
            <th>人工结论</th>
            <th>修改成本</th>
            <th class="th-ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="c in filtered" :key="c.id">
            <tr
              :data-case-id="c.id"
              :class="{
                risk: overallOf(c) === 'unknown',
                selected: selectedCaseIds.has(c.id),
                'highlight-ai': highlightedCaseId === c.id,
                'canvas-focused-row': canvasFocus?.id === c.id,
                'is-expanded': expandedCaseIds.has(c.id),
              }"
              @click="emit('row-select', c)"
            >
              <td class="td-expand">
                <button
                  type="button"
                  class="caret-toggle-btn"
                  :class="{ open: expandedCaseIds.has(c.id) }"
                  title="展开/收起步骤断言"
                  @click="toggleExpand(c.id, $event)"
                >
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
                    <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </td>
              <td class="td-checkbox">
                <input
                  type="checkbox"
                  :checked="selectedCaseIds.has(c.id)"
                  aria-label="选择此用例"
                  @click.stop
                  @change="emit('toggle-select-case', c.id)"
                />
              </td>
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
                  @click.stop
                  @change="
                    emit('patch-case', c, {
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
                  @click.stop
                  @change="
                    emit('patch-case', c, {
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
                  @click.stop
                  @change="
                    emit('assess-case', c, {
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
                  @click.stop
                  @change="
                    emit('assess-case', c, {
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
              <td class="td-ops">
                <div class="ops">
                  <div class="case-agent-btns">
                    <button
                      type="button"
                      class="case-agent-btn reviewer"
                      title="检查这条用例并给出建议，不改写内容"
                      @click.stop="emit('dispatch-to-role', c, 'reviewer')"
                    >
                      检查
                    </button>
                  </div>
                  <n-button size="tiny" quaternary @click.stop="emit('open-editor', c)"
                    >编辑</n-button
                  >
                  <n-button
                    size="tiny"
                    quaternary
                    type="error"
                    @click.stop="emit('remove-case', c)"
                    >删除</n-button
                  >
                </div>
              </td>
            </tr>

            <!-- 步骤与预期展开详情行 -->
            <tr v-if="expandedCaseIds.has(c.id)" :key="`detail-${c.id}`" class="case-detail-row">
              <td colspan="10" class="detail-cell">
                <div class="case-expanded-box">
                  <div v-if="c.precondition" class="detail-precondition">
                    <span class="detail-label">前置条件：</span>
                    <span class="precondition-text">{{ c.precondition }}</span>
                  </div>

                  <div class="detail-steps-grid">
                    <div class="steps-col">
                      <div class="grid-col-header">
                        <span class="col-icon">🪜</span>
                        <strong>操作步骤 ({{ c.steps?.length || 0 }})</strong>
                      </div>
                      <ol v-if="c.steps?.length" class="step-ol">
                        <li v-for="(step, sIdx) in c.steps" :key="sIdx" class="step-li">
                          {{ step }}
                        </li>
                      </ol>
                      <div v-else class="empty-hint">暂未填写步骤</div>
                    </div>

                    <div class="expected-col">
                      <div class="grid-col-header">
                        <span class="col-icon">🎯</span>
                        <strong>可判定预期 ({{ c.expected?.length || 0 }})</strong>
                      </div>
                      <ol v-if="c.expected?.length" class="expected-ol">
                        <li v-for="(exp, eIdx) in c.expected" :key="eIdx" class="expected-li">
                          {{ exp }}
                        </li>
                      </ol>
                      <div v-else class="empty-hint">暂未填写预期断言</div>
                    </div>
                  </div>

                  <div v-if="c.assumptions?.length" class="detail-assumptions">
                    <div class="assumptions-title">
                      <span class="warn-icon">⚠️</span>
                      <strong>需求缺口假设（未在需求中明确定义）：</strong>
                    </div>
                    <ul class="assumptions-ul">
                      <li v-for="(a, aIdx) in c.assumptions" :key="aIdx">{{ a }}</li>
                    </ul>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.more-tools { position: relative; font-size: 12px; }
.more-tools > summary { cursor: pointer; padding: 5px 8px; color: var(--tp-text-dim); }
.tool-menu { position: absolute; right: 0; top: 100%; min-width: 180px; z-index: 20; padding: 8px; display: grid; gap: 4px; background: var(--tp-panel); border: 1px solid var(--tp-border); border-radius: 5px; box-shadow: 0 6px 20px #0f172a14; }

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
.case-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.table-scroll {
  max-height: min(65vh, 720px);
  overflow: auto;
  border: 1px solid var(--tp-border);
  border-radius: 5px;
}
.case-table {
  width: 100%;
  min-width: 980px;
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
.case-table tr.highlight-ai {
  background: #f0fdf4 !important;
  box-shadow: inset 0 0 0 2px #22c55e !important;
  animation: pulse-glow 2s ease-in-out infinite alternate;
}
@keyframes pulse-glow {
  from { background-color: #f0fdf4; }
  to { background-color: #dcfce7; }
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
.th-expand,
.td-expand,
.th-checkbox,
.td-checkbox {
  text-align: center !important;
  vertical-align: middle !important;
  padding: 6px 0 !important;
}
.th-checkbox input,
.td-checkbox input {
  display: block;
  margin: 0 auto;
  cursor: pointer;
}
.caret-toggle-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  border-radius: 4px;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s ease;
}
.caret-toggle-btn:hover {
  color: #2563eb;
  background: #eff6ff;
}
.caret-toggle-btn.open {
  transform: rotate(90deg);
  color: #2563eb;
}
.case-table tr.is-expanded {
  background: #f8fafc;
  border-bottom: none;
}
.case-detail-row {
  background: #f8fafc;
}
.detail-cell {
  padding: 0 12px 14px !important;
  background: #f8fafc;
}
.case-expanded-box {
  padding: 12px 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}
.detail-precondition {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  margin-bottom: 10px;
}
.detail-label {
  font-weight: 700;
  color: #475569;
}
.precondition-text {
  color: #1e293b;
}

.detail-steps-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.steps-col, .expected-col {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px 12px;
}
.grid-col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #1e293b;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 6px;
  margin-bottom: 8px;
}
.col-icon {
  font-size: 13px;
}
.step-ol, .expected-ol {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.6;
  color: #334155;
}
.step-li {
  margin-bottom: 3px;
}
.expected-li {
  margin-bottom: 3px;
  color: #0f766e;
}
.empty-hint {
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
  padding: 4px 0;
}
.detail-assumptions {
  margin-top: 10px;
  background: #fffbeb;
  border: 1px solid #fef3c7;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
}
.assumptions-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #92400e;
  font-weight: 600;
  margin-bottom: 4px;
}
.assumptions-ul {
  margin: 0;
  padding-left: 18px;
  color: #b45309;
}

.cell-input {
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--tp-text);
  font-size: 13px;
  padding: 3px 6px;
  margin-left: -6px;
  outline: none;
  font-family: inherit;
  text-overflow: ellipsis;
}
.cell-input:hover { border-color: var(--tp-border); }
.cell-input:focus { border-color: var(--tp-accent); background: var(--tp-panel-2); }
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
.cell-select:hover { border-color: var(--tp-border); }
.cell-select:focus-visible { outline: 2px solid var(--tp-accent); outline-offset: 1px; }
.cell-select:disabled { opacity: 0.4; cursor: not-allowed; }
.ops {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  white-space: nowrap;
}
.case-table th.th-ops,
.case-table td.td-ops {
  position: sticky;
  right: 0;
  z-index: 2;
  background: var(--tp-panel, #ffffff);
  box-shadow: -2px 0 6px rgba(0, 0, 0, 0.05);
}
.case-table th.th-ops {
  z-index: 3;
  background: var(--tp-panel-2, #f6f8fa);
}
.case-table tbody tr:hover td.td-ops {
  background: var(--tp-panel-2, #f7f9fb);
}
.case-table tr.risk td.td-ops {
  background: #fff5f5;
}
.case-table tr.risk:hover td.td-ops {
  background: #fee2e2;
}
.case-table tr.selected td.td-ops {
  background: #f0f7ff;
}
.case-table tr.canvas-focused-row td.td-ops {
  background: #f0fdf4;
}
/* 批量勾选工具条 */
.cases-batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: #f0f7ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  margin-bottom: 12px;
  animation: fadeIn 0.2s ease;
}
.batch-count { font-size: 13px; color: #1e3a8a; }
.batch-count b { font-weight: 700; color: #2563eb; }
.batch-actions { display: flex; align-items: center; gap: 8px; }
.batch-agent-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 5px;
  border: 1px solid #2563eb;
  background: #2563eb;
  color: #ffffff;
  cursor: pointer;
  transition: all 0.15s ease;
}
.batch-agent-btn:hover { background: #1d4ed8; border-color: #1d4ed8; }
.batch-agent-btn.secondary { background: #ffffff; color: #2563eb; border-color: #93c5fd; }
.batch-agent-btn.secondary:hover { background: #eff6ff; border-color: #60a5fa; }
.batch-clear-btn {
  background: transparent;
  border: none;
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  padding: 4px 8px;
}
.batch-clear-btn:hover { color: #1e293b; }
.case-table tr.selected { background: #f0f7ff !important; }
.case-table tr.canvas-focused-row {
  background: #f0fdf4 !important;
  box-shadow: inset 3px 0 0 #16a34a;
}
.case-agent-btns { display: inline-flex; align-items: center; gap: 4px; }
.case-agent-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
  background: #ffffff;
  white-space: nowrap;
}
.case-agent-btn.reviewer { color: #15803d; background: #f0fdf4; border-color: #bbf7d0; }
.case-agent-btn.reviewer:hover { background: #dcfce7; border-color: #86efac; }
.case-agent-btn.qa { color: #c2410c; background: #fff7ed; border-color: #fed7aa; }
.case-agent-btn.qa:hover { background: #ffedd5; border-color: #fdba74; }
.ai-hunter-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.ai-hunter-btn:hover { background: #dcfce7; border-color: #22c55e; }
.module-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tiny-text { font-size: 12px; }
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 600px) {
  .cases-panel { padding: 12px; }
}
</style>
