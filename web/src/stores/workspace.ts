import { computed, ref } from 'vue'
import type { Project, RequirementVersion, TestCase } from '../types'

/** 模块级 ref 单例：所有视图共享同一份工作区状态 */
export const projects = ref<Project[]>([])
export const currentProjectId = ref<string | null>(null)

export const requirements = ref<RequirementVersion[]>([])
export const currentRequirementId = ref<string | null>(null)

export const cases = ref<TestCase[]>([])

/**
 * 用例变更信号：n-tabs 的面板常驻，切页签不会重新 onMounted。
 * 用例页改动后 bump 一下，评审页的汇总才能跟着刷新。
 */
export const casesRevision = ref(0)
export function bumpCases(): void {
  casesRevision.value++
}

export const currentProject = computed(
  () => projects.value.find((p) => p.id === currentProjectId.value) ?? null,
)

export const currentRequirement = computed(
  () => requirements.value.find((r) => r.id === currentRequirementId.value) ?? null,
)

export const readyRequirement = computed(() => {
  const req = currentRequirement.value
  return req ? req.chunks.length > 0 : false
})
