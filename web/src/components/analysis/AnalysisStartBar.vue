<script setup lang="ts">
import { NButton, NProgress, NSpin, NTag } from "naive-ui";
import type { RequirementAnalysis } from "../../types";

interface AnalysisStreamState {
  batch: number;
  totalBatches: number;
  currentChunks: { reqId: string; sectionPath: string }[];
  totalPoints: number;
  message: string;
  logs: string[];
}

const props = defineProps<{
  busy: boolean;
  hasContent: boolean;
  loadFailed: boolean;
  hasDraft: boolean;
  operation: "load" | "analyze" | "save" | undefined;
  analysis: RequirementAnalysis | null;
  analysisProgress: AnalysisStreamState | null;
  versionLabel: string;
  pointTotal: number;
}>();

const emit = defineEmits<{
  requestAnalysis: [];
  scanVulnerabilities: [];
  analyzePathways: [];
}>();
</script>

<template>
  <div class="analysis-head">
    <div class="head-title">
      <h3 class="section-title">需求理解与测试点</h3>
      <n-tag v-if="analysis" size="tiny" :bordered="false" round>{{
        pointTotal
      }}</n-tag>
    </div>
    <div class="button-row">
      <details v-if="analysis" class="extra-analysis">
        <summary>补充分析</summary>
        <div class="extra-menu">
          <button type="button" class="ai-tool-btn ai-hunter-btn" :disabled="busy || hasDraft" title="需求分析师：提出待核对风险，不生成用例" @click="emit('scanVulnerabilities')">风险走查</button>
          <button type="button" class="ai-tool-btn ai-analyst-btn" :disabled="busy || hasDraft" title="需求分析师：梳理业务路径和待澄清规则" @click="emit('analyzePathways')">梳理业务路径</button>
        </div>
      </details>
      <n-button
        size="small"
        type="primary"
        :loading="operation === 'analyze'"
        :disabled="busy || !hasContent || loadFailed || hasDraft"
        @click="emit('requestAnalysis')"
        >{{ analysis ? "重新分析" : "分析需求、提炼测试点" }}</n-button
      >
    </div>
  </div>

  <!-- Analysis progress inspector -->
  <div v-if="operation === 'analyze' && analysisProgress" class="analysis-inspector" role="status">
    <div class="inspector-header">
      <div class="inspector-title">
        <n-spin size="small" />
        <strong>大模型测试分析实时控制台</strong>
        <n-tag size="tiny" type="info" :bordered="false">深度剖析中</n-tag>
      </div>
      <div class="inspector-badge">
        已提炼测试点：<strong class="highlight-number">{{ analysisProgress.totalPoints }}</strong> 个
      </div>
    </div>

    <div class="inspector-progress">
      <div class="progress-meta small-text">
        <span>条款分析进度：第 {{ analysisProgress.batch }} / {{ analysisProgress.totalBatches }} 批</span>
        <span class="mono">{{ Math.round((analysisProgress.batch / (analysisProgress.totalBatches || 1)) * 100) }}%</span>
      </div>
      <n-progress
        type="line"
        :percentage="Math.min(100, Math.round((analysisProgress.batch / (analysisProgress.totalBatches || 1)) * 100))"
        :show-indicator="false"
        status="info"
        processing
      />
    </div>

    <div v-if="analysisProgress.currentChunks.length" class="current-chunks-card">
      <span class="chunk-badge-label">正在研读条款：</span>
      <div class="chunk-tags">
        <n-tag v-for="c in analysisProgress.currentChunks" :key="c.reqId" size="small" type="primary" :bordered="false">
          {{ c.reqId }} · {{ c.sectionPath }}
        </n-tag>
      </div>
    </div>

    <div class="pipeline-steps">
      <div class="pipeline-step">
        <span class="step-num">1</span>
        <span class="step-text">条款语义解构</span>
      </div>
      <span class="step-arrow">➔</span>
      <div class="pipeline-step">
        <span class="step-num">2</span>
        <span class="step-text">测试方法映射 (等价/边界/异常)</span>
      </div>
      <span class="step-arrow">➔</span>
      <div class="pipeline-step">
        <span class="step-num">3</span>
        <span class="step-text">原文依据逐字锚定</span>
      </div>
      <span class="step-arrow">➔</span>
      <div class="pipeline-step">
        <span class="step-num">4</span>
        <span class="step-text">提炼测试点矩阵</span>
      </div>
    </div>

    <div class="inspector-logs">
      <div class="log-current small-text">
        ✦ {{ analysisProgress.message }}
      </div>
      <details class="log-history">
        <summary class="small-text text-dim">展开查看分析执行日志 ({{ analysisProgress.logs.length }} 条)</summary>
        <div class="log-scroll">
          <div v-for="(log, idx) in analysisProgress.logs" :key="idx" class="mono log-line">
            {{ log }}
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.extra-analysis { position: relative; font-size: 12px; }
.extra-analysis summary { cursor: pointer; color: var(--tp-text-dim); }
.extra-menu { position: absolute; right: 0; top: 100%; z-index: 20; min-width: 130px; padding: 8px; display: grid; gap: 6px; background: var(--tp-panel); border: 1px solid var(--tp-border); border-radius: 5px; }
.analysis-head,
.button-row {
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
.small-text {
  font-size: 12px;
}
.ai-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.ai-hunter-btn {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
}
.ai-hunter-btn:hover {
  background: #ffedd5;
  border-color: #f97316;
}
.ai-analyst-btn {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  color: #0369a1;
}
.ai-analyst-btn:hover {
  background: #e0f2fe;
  border-color: #38bdf8;
}

.analysis-inspector {
  margin: 14px 0 18px;
  padding: 16px;
  background: var(--tp-panel, #ffffff);
  border: 1px solid var(--tp-border, #e2e8f0);
  border-left: 4px solid var(--tp-primary, #2563eb);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.inspector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.inspector-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.inspector-badge {
  font-size: 13px;
  color: var(--tp-text-dim, #64748b);
}
.highlight-number {
  color: #10b981;
  font-size: 16px;
  font-family: monospace;
}
.inspector-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.progress-meta {
  display: flex;
  justify-content: space-between;
  color: var(--tp-text-dim, #64748b);
}
.current-chunks-card {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: rgba(37, 99, 235, 0.04);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px dashed rgba(37, 99, 235, 0.2);
}
.chunk-badge-label {
  font-size: 12px;
  color: var(--tp-text-dim, #64748b);
  font-weight: 500;
}
.chunk-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.pipeline-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 0;
  font-size: 12px;
}
.pipeline-step {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #334155;
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 500;
}
.step-num {
  font-weight: 700;
  font-size: 11px;
  background: #2563eb;
  color: #fff;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.step-arrow {
  color: #94a3b8;
  font-size: 11px;
}
.inspector-logs {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 10px 12px;
  border-radius: 6px;
}
.log-current {
  color: #0284c7;
  font-weight: 500;
  margin-bottom: 6px;
}
.log-history summary {
  cursor: pointer;
  user-select: none;
}
.log-scroll {
  max-height: 120px;
  overflow-y: auto;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.log-line {
  font-size: 11px;
  color: var(--tp-text-dim, #64748b);
  line-height: 1.4;
}
</style>
