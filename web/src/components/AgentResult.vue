<script setup lang="ts">
import { NButton } from 'naive-ui'
import type { AgentAction } from '@testpilot/shared'
import { activeTab } from '../stores/workspace'
import PathwayViewer from './PathwayViewer.vue'
import RiskScanResult from './RiskScanResult.vue'
defineProps<{ action: AgentAction }>()

function goBack(target: 'points' | 'requirement') {
  activeTab.value = target
}
</script>

<template>
  <section class="insight panel">
    <div class="insight-nav-bar">
      <div class="nav-left">
        <n-button size="small" secondary @click="goBack('points')">← 返回需求测试点</n-button>
        <n-button size="small" quaternary @click="goBack('requirement')">返回需求资料</n-button>
      </div>
      <span class="insight-nav-tip">深度分析报告详情</span>
    </div>
    <h2>{{ action.title }}</h2>
    <p class="note">本次分析来自模型建议，需结合需求原文核对；候选场景尚未保存为测试用例。</p>
    <PathwayViewer v-if="action.tool === 'analyze_pathways'" :data="action.data" />
    <RiskScanResult v-else-if="action.tool === 'scan_vulnerabilities'" :action="action" />
    <template v-else-if="action.tool === 'check_coverage'"><div class="coverage">{{ Math.round(action.data.rate * 100) }}% <small>条款有用例引用</small></div><p>{{ action.data.totalCases }} 条用例 · {{ action.data.uncoveredCount }} 条可测条款尚无引用</p><ul><li v-for="item in action.data.uncovered" :key="item.reqId">{{ item.reqId }} · {{ item.sectionPath }}</li></ul></template>
    <details><summary>查看完整返回</summary><pre>{{ JSON.stringify(action.data, null, 2) }}</pre></details>
  </section>
</template>

<style scoped>
.insight-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--tp-border, #e2e8f0);
}
.nav-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.insight-nav-tip {
  font-size: 12px;
  color: var(--tp-text-dim, #64748b);
  background: var(--tp-panel-2, #f1f5f9);
  padding: 2px 8px;
  border-radius: 4px;
}
.insight { font-size:13px; line-height:1.8; }
h2 { margin:0; font-size:19px; color:#304d66; }
.note { color:#91a0ad; font-size:12px; margin-top: 4px; }
article { padding:15px; margin:14px 0; background:#f7f9fc; border:1px solid #e3e9ef; border-radius:7px; }
h3 { font-size:14px; margin:8px 0; }
.issue-meta { color:#9a8156; font-size:11px; }
.coverage { font-size:30px; color:#466b8b; }
.coverage small { font-size:12px; }
details { margin-top:12px; }
summary { color:#64819b; cursor:pointer; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:400px; overflow:auto; }
</style>
