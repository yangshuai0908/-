<script setup lang="ts">
import { computed } from 'vue'
import { activeTab, currentRequirement, cases, selectedAgentResult } from '../stores/workspace'
import { isHumanConfirmed, type WorkspacePage } from '@testpilot/shared'

interface StepDef {
  id: WorkspacePage
  number: string
  title: string
  badgeText: string
  badgeType: 'default' | 'success' | 'warning' | 'info' | 'danger'
  clickable: boolean
}

const reqChunksCount = computed(() => currentRequirement.value?.chunks.length ?? 0)

const pointsStats = computed(() => {
  const sections = currentRequirement.value?.analysis?.sections ?? []
  const all = sections.flatMap((s) => s.points)
  const confirmed = all.filter(isHumanConfirmed).length
  const pending = all.filter((p) => p.status === 'pending' || (p.status === 'confirmed' && !isHumanConfirmed(p))).length
  const total = all.length
  return { total, confirmed, pending, hasAnalysis: Boolean(currentRequirement.value?.analysis) }
})

const casesStats = computed(() => {
  const list = cases.value
  const total = list.length
  const effective = list.filter((c) => c.assessment?.verdict === 'effective').length
  const unverified = list.filter((c) => c.evidence.some((e) => e.quoteMatch === 'missing' || e.quoteMatch === 'fuzzy')).length
  return { total, effective, unverified }
})

const steps = computed<StepDef[]>(() => {
  const hasReq = Boolean(currentRequirement.value)
  const pStats = pointsStats.value
  const cStats = casesStats.value

  const list: StepDef[] = [
    {
      id: 'requirement',
      number: '01',
      title: '需求资料',
      badgeText: !hasReq ? '待选择' : reqChunksCount.value > 0 ? `已切块 ${reqChunksCount.value} 条` : '未切块',
      badgeType: !hasReq ? 'default' : reqChunksCount.value > 0 ? 'success' : 'warning',
      clickable: true,
    },
    {
      id: 'points',
      number: '02',
      title: '需求分析与测试点',
      badgeText: !hasReq
        ? '待就绪'
        : !pStats.hasAnalysis
          ? '待分析'
          : pStats.pending > 0
            ? `待确认 ${pStats.pending}`
            : pStats.confirmed > 0
              ? `已确认 ${pStats.confirmed}`
              : '无测试点',
      badgeType: !hasReq || !pStats.hasAnalysis ? 'default' : pStats.pending > 0 ? 'warning' : 'success',
      clickable: hasReq,
    },
    {
      id: 'cases',
      number: '03',
      title: '测试用例',
      badgeText: cStats.total === 0 ? '待生成' : `已生成 ${cStats.total} 条`,
      badgeType: cStats.total === 0 ? 'default' : cStats.unverified > 0 ? 'warning' : 'success',
      clickable: hasReq,
    },
    {
      id: 'review',
      number: '04',
      title: '质量评审',
      badgeText: cStats.total === 0 ? '未就绪' : `有效 ${cStats.effective}/${cStats.total}`,
      badgeType: cStats.total === 0 ? 'default' : 'info',
      clickable: hasReq,
    },
    {
      id: 'compare',
      number: '05',
      title: '版本对比',
      badgeText: '变更影响',
      badgeType: 'default',
      clickable: true,
    },
  ]

  if (selectedAgentResult.value?.artifact?.view === 'insights') {
    const rawTitle = selectedAgentResult.value.title || '模型分析结果'
    list.push({
      id: 'insights',
      number: '✦',
      title: '分析结果',
      badgeText: rawTitle.length > 8 ? `${rawTitle.slice(0, 8)}…` : rawTitle,
      badgeType: 'info',
      clickable: true,
    })
  }

  return list
})

function selectStep(step: StepDef) {
  if (step.clickable) {
    activeTab.value = step.id
  }
}
</script>

<template>
  <nav class="workflow-stepper" aria-label="测试工程生命周期">
    <div class="stepper-track">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="step-item"
        :class="{
          active: activeTab === step.id,
          disabled: !step.clickable,
        }"
        @click="selectStep(step)"
      >
        <div class="step-indicator">
          <span class="step-num">{{ step.number }}</span>
          <span class="step-dot" />
        </div>
        <div class="step-content">
          <span class="step-title">{{ step.title }}</span>
          <span class="step-badge" :class="step.badgeType">{{ step.badgeText }}</span>
        </div>
        <div v-if="index < steps.length - 1" class="step-arrow" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.workflow-stepper {
  display: flex;
  align-items: center;
  background: #ffffff;
  border-bottom: 1px solid #e5eaf0;
  padding: 8px 24px;
  user-select: none;
  overflow-x: auto;
  flex-shrink: 0;
}

.stepper-track {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: max-content;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid transparent;
  background: transparent;
}

.step-item:hover:not(.disabled) {
  background: #f4f7fb;
  border-color: #e2e8f0;
}

.step-item.active {
  background: #eff6ff;
  border-color: #bfdbfe;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.08);
}

.step-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.step-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.step-num {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: -0.02em;
}

.step-item.active .step-num {
  color: #2563eb;
}

.step-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
  transition: all 0.2s ease;
}

.step-item.active .step-dot {
  background: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
}

.step-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.step-title {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  line-height: 1.3;
}

.step-item.active .step-title {
  color: #1e3a8a;
}

.step-badge {
  font-size: 11px;
  line-height: 1.2;
  font-weight: 500;
  color: #64748b;
}

.step-badge.success {
  color: #059669;
}

.step-badge.warning {
  color: #d97706;
  font-weight: 600;
}

.step-badge.info {
  color: #2563eb;
}

.step-arrow {
  color: #cbd5e1;
  display: flex;
  align-items: center;
  margin-left: 4px;
}

@media (max-width: 900px) {
  .workflow-stepper {
    padding: 6px 16px;
  }
  .step-item {
    padding: 5px 10px;
    gap: 8px;
  }
}
</style>
