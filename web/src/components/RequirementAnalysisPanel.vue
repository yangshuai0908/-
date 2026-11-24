<script setup lang="ts">
import {
  NAlert,
  NButton,
  NSpin,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { computed } from "vue";
import { activeTab, openRiskScan } from "../stores/workspace";
import type { RequirementVersion } from "../types";
import AnalysisStartBar from "./analysis/AnalysisStartBar.vue";
import AnalysisSection from "./analysis/AnalysisSection.vue";
import TestPointEditDrawer from "./analysis/TestPointEditDrawer.vue";
import BatchConfirmModal from "./analysis/BatchConfirmModal.vue";
import { useRequirementAnalysis } from "./analysis/useRequirementAnalysis";

const props = defineProps<{ requirement: RequirementVersion }>();
const emit = defineEmits<{ refresh: [] }>();
const dialog = useDialog();
const message = useMessage();
const riskQuestions = computed(() => (props.requirement.riskScans ?? []).flatMap(scan =>
  scan.issues.filter(issue => issue.resolution?.action === 'question').map(issue => ({ scanId: scan.id, ...issue }))
));

const {
  analysis,
  operation,
  busy,
  hasContent,
  error,
  loadFailed,
  editorError,
  analysisProgress,
  showBatchModal,
  batchReviewer,
  batchOnlyClear,
  batchComment,
  batchConfirming,
  openBatchConfirmModal,
  executeBatchConfirm,
  draft,
  chunkOptions,
  chunksById,
  counts,
  pointTotal,
  loadAnalysis,
  requestAnalysis,
  cancelAnalysis,
  openEditor,
  closeEditor,
  savePoint,
  quickConfirmPoint,
  quickExcludePoint,
  askAgentForQuestions,
  askAgentForPointQuestions,
  focusPoint,
  consultPoint,
  scanVulnerabilitiesWithAgent,
} = useRequirementAnalysis(props, (evt) => emit(evt), dialog, message);
</script>

<template>
  <section class="panel">
    <AnalysisStartBar
      :busy="busy"
      :has-content="hasContent"
      :load-failed="loadFailed"
      :has-draft="Boolean(draft)"
      :operation="operation"
      :analysis="analysis"
      :analysis-progress="analysisProgress"
      :version-label="requirement.label"
      :point-total="pointTotal"
      @request-analysis="requestAnalysis"
      @cancel-analysis="cancelAnalysis"
      @scan-vulnerabilities="scanVulnerabilitiesWithAgent"
    />

    <div class="head-note text-dim small-text">
      AI 助手辅助提炼测试点和待澄清问题，经人工核对确认后即可开展用例生成。
    </div>

    <n-alert v-if="riskQuestions.length" type="warning" :show-icon="false" class="notice">
      <strong>风险走查待澄清（{{ riskQuestions.length }}）</strong>
      <p>请向需求方确认规则；已有明确依据后可补充候选测试点，仍需人工核对。</p>
      <div v-for="issue in riskQuestions" :key="issue.id" class="risk-question">
        <span>{{ issue.reqId }} · {{ issue.question }}</span>
        <n-button size="tiny" @click="openRiskScan(requirement.id, issue.scanId)">核对并继续处理 →</n-button>
      </div>
    </n-alert>

    <n-alert v-if="error" type="error" class="notice" title="请求未完成">
      {{ error }}
      <div v-if="loadFailed" style="margin-top: 8px">
        <n-button size="tiny" secondary @click="loadAnalysis(true)">重试加载</n-button>
      </div>
    </n-alert>

    <div v-if="operation && operation !== 'analyze'" class="loading-note" role="status">
      <n-spin size="small" />
      <span>{{
        operation === "save"
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
        <span class="small-text text-dim">测试点状态：</span>
        <n-tag size="small" type="warning" :bordered="false"
          >待确认 {{ counts.pending }}</n-tag
        >
        <n-tag size="small" type="success" :bordered="false"
          >已确认 {{ counts.confirmed }}</n-tag
        >
        <n-tag size="small" :bordered="false"
          >已排除 {{ counts.excluded }}</n-tag
        >
        <div style="flex: 1"></div>
        <n-button
          v-if="counts.pending > 0"
          size="small"
          type="success"
          secondary
          :disabled="busy"
          @click="openBatchConfirmModal"
        >
          ✓ 批量确认测试点
        </n-button>
        <n-button
          v-if="counts.confirmed > 0"
          size="small"
          type="primary"
          @click="activeTab = 'cases'"
        >
          前往生成用例 ➔
        </n-button>
      </div>
      <n-alert type="info" :show-icon="false" class="notice">
        原文定位不等于测试目标已被需求支持。「确认」仅表示人工认可测试目标，不代表待确认问题已解决，也不代表规则已自动校验。
      </n-alert>
      <div v-if="!analysis.sections.length" class="empty">
        分析未返回条款或测试点，请核对需求内容后重试。
      </div>

      <AnalysisSection
        v-for="section in analysis.sections"
        :key="section.reqId"
        :section="section"
        :chunks-by-id="chunksById"
        :busy="busy"
        @open-editor="openEditor"
        @quick-confirm="quickConfirmPoint"
        @quick-exclude="quickExcludePoint"
        @focus-point="focusPoint"
        @ask-agent-for-questions="askAgentForQuestions"
        @ask-agent-for-point-questions="askAgentForPointQuestions"
        @consult-point="consultPoint"
      />
    </template>

    <TestPointEditDrawer
      :draft="draft"
      :busy="busy"
      :saving="operation === 'save'"
      :editor-error="editorError"
      :chunks="requirement.chunks"
      :chunks-by-id="chunksById"
      :chunk-options="chunkOptions"
      @close="closeEditor"
      @save="savePoint"
    />

    <BatchConfirmModal
      v-model:show="showBatchModal"
      v-model:reviewer="batchReviewer"
      v-model:only-clear="batchOnlyClear"
      v-model:comment="batchComment"
      :loading="batchConfirming"
      @confirm="executeBatchConfirm"
    />
  </section>
</template>

<style scoped>
.risk-question { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.head-note {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--tp-border);
}
.small-text {
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
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
</style>
