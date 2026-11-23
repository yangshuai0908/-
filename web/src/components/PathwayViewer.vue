<script setup lang="ts">
import { computed, ref } from "vue";
import { NTag } from "naive-ui";
import { sendToAgent } from "../stores/workspace";

export interface PathwayData {
  requirementLabel?: string;
  summary?: string;
  coreHappyPath?: Array<{
    name: string;
    description?: string;
    steps: string[];
  }>;
  stateMachine?: Array<{
    fromState: string;
    toState: string;
    trigger: string;
    conditions?: string;
    result: string;
  }>;
  implicitRules?: Array<{
    category: string;
    issues: string[];
  }>;
}

const props = defineProps<{
  data: PathwayData;
}>();

const activeTab = ref<"happypath" | "states" | "blindspots">("happypath");

const happyPaths = computed(() => props.data.coreHappyPath || []);
const stateTransitions = computed(() => props.data.stateMachine || []);
const blindspots = computed(() => props.data.implicitRules || []);

const totalIssues = computed(() =>
  blindspots.value.reduce((acc, cat) => acc + (cat.issues?.length || 0), 0)
);

function generateCaseFromHappyPath(flow: { name: string; steps: string[] }) {
  const stepsList = flow.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const prompt = `请根据已梳理的核心正向业务闭环【${flow.name}】：
步骤顺序：
${stepsList}

请由需求分析师核对路径的原文依据，给出候选测试点及待澄清问题。只给出建议，不新增用例或代替人工确认。`;
  sendToAgent({
    prompt,
    role: "analyst",
    autoSend: true,
  });
}

function attackStateTransition(item: {
  fromState: string;
  toState: string;
  trigger: string;
  result: string;
}) {
  const prompt = `请作为【需求分析师】，针对状态机流转：
【${item.fromState}】 ──( ${item.trigger} )──> 【${item.toState}】（结果：${item.result}）
核对流转规则和异常分支：
1. 分析是否存在并发竞争、死锁绕过、条件失效或逆向回退攻击面；
2. 输出带原文依据的候选测试点和待澄清问题，不生成用例或自行补写规则。`;
  sendToAgent({
    prompt,
    role: "analyst",
    autoSend: true,
  });
}

function organizeClarificationDoc() {
  const allIssues = blindspots.value
    .map(
      (b) =>
        `### ${b.category}\n${b.issues.map((issue, idx) => `${idx + 1}. ${issue}`).join("\n")}`
    )
    .join("\n\n");
  const prompt = `请作为【需求分析师】，将以下梳理出的 ${totalIssues.value} 项隐式规则与契约盲区，整理为一份专业规范的《产品需求与接口契约澄清确认单》供研发和产品评审签字：\n\n${allIssues}`;
  sendToAgent({
    prompt,
    role: "analyst",
    autoSend: true,
  });
}
</script>

<template>
  <div class="pathway-viewer">
    <!-- 顶栏标题与摘要 -->
    <div class="pv-header">
      <div class="pv-title-row">
        <span class="pv-role-badge">需求分析师 · 路径分析</span>
        <strong class="pv-main-title">业务主干闭环与状态机图谱</strong>
        <n-tag v-if="data.requirementLabel" size="tiny" :bordered="false" round type="info">
          {{ data.requirementLabel }}
        </n-tag>
      </div>
      <p v-if="data.summary" class="pv-summary">{{ data.summary }}</p>
    </div>

    <!-- 导航切换胶囊 -->
    <div class="pv-nav">
      <button
        type="button"
        class="pv-tab-btn"
        :class="{ active: activeTab === 'happypath' }"
        @click="activeTab = 'happypath'"
      >
        <span>🌟 核心正向链路</span>
        <span class="pv-count-tag">{{ happyPaths.length }}</span>
      </button>
      <button
        type="button"
        class="pv-tab-btn"
        :class="{ active: activeTab === 'states' }"
        @click="activeTab = 'states'"
      >
        <span>🔄 状态机流转图谱</span>
        <span class="pv-count-tag">{{ stateTransitions.length }}</span>
      </button>
      <button
        type="button"
        class="pv-tab-btn"
        :class="{ active: activeTab === 'blindspots' }"
        @click="activeTab = 'blindspots'"
      >
        <span>⚠️ 隐式规则与盲区</span>
        <span class="pv-count-tag warn">{{ totalIssues }}</span>
      </button>
    </div>

    <!-- Tab 1: 核心正向业务闭环 -->
    <div v-if="activeTab === 'happypath'" class="pv-content">
      <div v-for="(flow, idx) in happyPaths" :key="idx" class="flow-card">
        <div class="flow-header">
          <div class="flow-title-wrap">
            <span class="flow-index">0{{ idx + 1 }}</span>
            <strong class="flow-name">{{ flow.name }}</strong>
            <span class="flow-steps-pill">{{ flow.steps?.length || 0 }} 步闭环</span>
          </div>
          <button
            type="button"
            class="flow-to-case-btn"
            title="需求分析师：核对路径并给出候选测试点建议"
            @click="generateCaseFromHappyPath(flow)"
          >
            提炼测试点建议
          </button>
        </div>

        <div class="steps-pipeline">
          <div
            v-for="(step, sIdx) in flow.steps"
            :key="sIdx"
            class="pipeline-node"
          >
            <div class="node-left">
              <span class="node-num">{{ sIdx + 1 }}</span>
              <div v-if="sIdx < flow.steps.length - 1" class="node-line" />
            </div>
            <div class="node-content">
              <span class="step-text">{{ step }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!happyPaths.length" class="empty-tip">未提取到正向链路</div>
    </div>

    <!-- Tab 2: 状态机流转图谱 -->
    <div v-else-if="activeTab === 'states'" class="pv-content">
      <div class="state-grid">
        <div
          v-for="(st, stIdx) in stateTransitions"
          :key="stIdx"
          class="state-trans-card"
        >
          <div class="state-flow-banner">
            <div class="state-pill from">{{ st.fromState }}</div>
            <div class="trans-arrow">
              <span class="trigger-label">{{ st.trigger }}</span>
              <div class="arrow-svg">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </div>
            </div>
            <div class="state-pill to">{{ st.toState }}</div>
          </div>

          <div class="state-meta-box">
            <div v-if="st.conditions && st.conditions !== '无'" class="state-meta-row">
              <span class="meta-label">约束条件：</span>
              <span class="meta-val">{{ st.conditions }}</span>
            </div>
            <div class="state-meta-row">
              <span class="meta-label">流转结果：</span>
              <span class="meta-val highlight">{{ st.result }}</span>
            </div>
          </div>

          <div class="state-card-footer">
            <button
              type="button"
              class="state-attack-btn"
              title="需求分析师：核对状态流转和异常规则"
              @click="attackStateTransition(st)"
            >
              核对流转规则
            </button>
          </div>
        </div>
      </div>
      <div v-if="!stateTransitions.length" class="empty-tip">未提取到系统状态机</div>
    </div>

    <!-- Tab 3: 隐式规则与盲区 -->
    <div v-else-if="activeTab === 'blindspots'" class="pv-content">
      <div class="blindspots-toolbar">
        <span class="blindspots-tip">共捕获 <b>{{ totalIssues }}</b> 项需求规则与契约盲区：</span>
        <button
          type="button"
          class="clarify-btn"
          @click="organizeClarificationDoc"
        >
          📝 一键生成产品澄清问卷
        </button>
      </div>

      <div class="categories-list">
        <div
          v-for="(cat, cIdx) in blindspots"
          :key="cIdx"
          class="blindspot-cat-card"
        >
          <div class="cat-header">
            <span class="cat-icon">⚠️</span>
            <strong class="cat-name">{{ cat.category }}</strong>
            <span class="cat-badge">{{ cat.issues?.length || 0 }} 项</span>
          </div>
          <ul class="issues-ul">
            <li v-for="(issue, iIdx) in cat.issues" :key="iIdx" class="issue-li">
              {{ issue }}
            </li>
          </ul>
        </div>
      </div>
      <div v-if="!blindspots.length" class="empty-tip">未发现隐式盲区与契约遗漏</div>
    </div>
  </div>
</template>

<style scoped>
.pathway-viewer {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
  font-size: 13px;
  margin: 6px 0;
}

.pv-header {
  padding: 12px 16px;
  background: linear-gradient(135deg, #f0f9ff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e0f2fe;
}
.pv-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pv-role-badge {
  font-size: 11px;
  font-weight: 600;
  color: #0284c7;
  background: #e0f2fe;
  padding: 2px 7px;
  border-radius: 4px;
}
.pv-main-title {
  font-size: 14px;
  color: #0f172a;
}
.pv-summary {
  margin: 6px 0 0;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
}

.pv-nav {
  display: flex;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 6px 12px;
  gap: 6px;
}
.pv-tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pv-tab-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.pv-tab-btn.active {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #0369a1;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.pv-count-tag {
  font-size: 10px;
  background: #e2e8f0;
  color: #475569;
  padding: 1px 5px;
  border-radius: 10px;
  font-weight: 600;
}
.pv-tab-btn.active .pv-count-tag {
  background: #e0f2fe;
  color: #0284c7;
}
.pv-count-tag.warn {
  background: #fef3c7;
  color: #d97706;
}

.pv-content {
  padding: 14px;
  max-height: 480px;
  overflow-y: auto;
}

/* 流程卡片 */
.flow-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: #fafbfc;
  transition: all 0.15s ease;
}
.flow-card:last-child {
  margin-bottom: 0;
}
.flow-card:hover {
  border-color: #93c5fd;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.04);
}
.flow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #e2e8f0;
}
.flow-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.flow-index {
  font-size: 11px;
  font-weight: 700;
  color: #0284c7;
  background: #e0f2fe;
  padding: 2px 6px;
  border-radius: 4px;
}
.flow-name {
  font-size: 13px;
  color: #1e293b;
}
.flow-steps-pill {
  font-size: 11px;
  color: #64748b;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 4px;
}
.flow-to-case-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  color: #0284c7;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.flow-to-case-btn:hover {
  background: #0284c7;
  color: #ffffff;
}

/* 步骤流水线 */
.steps-pipeline {
  display: flex;
  flex-direction: column;
}
.pipeline-node {
  display: flex;
  gap: 10px;
}
.node-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
}
.node-num {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  border-radius: 50%;
  background: #e0f2fe;
  color: #0284c7;
  flex-shrink: 0;
}
.node-line {
  width: 2px;
  flex: 1;
  min-height: 12px;
  background: #e2e8f0;
  margin: 3px 0;
}
.node-content {
  padding-bottom: 8px;
  flex: 1;
}
.step-text {
  font-size: 12.5px;
  color: #334155;
  line-height: 1.5;
}

/* 状态机卡片 */
.state-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.state-trans-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
}
.state-trans-card:hover {
  border-color: #cbd5e1;
}
.state-flow-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 6px;
  margin-bottom: 8px;
}
.state-pill {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}
.state-pill.from {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #bfdbfe;
}
.state-pill.to {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}
.trans-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
  padding: 0 8px;
}
.trigger-label {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  text-align: center;
}
.arrow-svg {
  color: #94a3b8;
}
.state-meta-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  padding: 6px 10px;
}
.state-meta-row {
  display: flex;
  gap: 6px;
}
.meta-label {
  color: #64748b;
  flex-shrink: 0;
}
.meta-val {
  color: #334155;
}
.meta-val.highlight {
  color: #b91c1c;
  font-weight: 500;
}
.state-card-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #f1f5f9;
}
.state-attack-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  color: #c2410c;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.state-attack-btn:hover {
  background: #c2410c;
  color: #ffffff;
}

/* 隐式盲区 */
.blindspots-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.blindspots-tip {
  font-size: 12.5px;
  color: #475569;
}
.blindspots-tip b {
  color: #d97706;
}
.clarify-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: #ffffff;
  background: #0284c7;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.clarify-btn:hover {
  background: #0369a1;
}
.categories-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.blindspot-cat-card {
  border: 1px solid #fed7aa;
  background: #fffaf5;
  border-radius: 8px;
  padding: 10px 14px;
}
.cat-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.cat-name {
  font-size: 13px;
  color: #9a3412;
}
.cat-badge {
  font-size: 10px;
  background: #ffedd5;
  color: #c2410c;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}
.issues-ul {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.issue-li {
  font-size: 12px;
  color: #431407;
  line-height: 1.5;
}

.empty-tip {
  text-align: center;
  color: #94a3b8;
  font-size: 12px;
  padding: 24px 0;
}
</style>

