export const AGENT_ROLE_IDS = ['team', 'analyst', 'qa_expert', 'reviewer'] as const
export type AgentRole = typeof AGENT_ROLE_IDS[number]

/** 页面名称、职责说明和服务端工具权限共用此定义；标识保持兼容历史对话。 */
export const AGENT_ROLES = {
  team: {
    label: '流程助手', icon: '🧭',
    description: '按当前阶段协调需求分析、用例设计和质量审查；不代替人工确认或评审。',
    tools: null,
  },
  analyst: {
    label: '需求分析师', icon: '📖',
    description: '分析需求、提炼候选测试点、整理待澄清问题和版本影响；不生成或修改用例。',
    tools: ['project_overview', 'read_requirement', 'search_cases', 'analyze_requirement', 'batch_confirm_points', 'scan_vulnerabilities', 'analyze_pathways', 'compare_versions'],
  },
  qa_expert: {
    label: '用例设计师', icon: '✏️',
    description: '基于人工确认的测试点生成用例，按明确指令修改用例；缺失规则交由需求分析师澄清，不自行补写规则或作出评审结论。',
    tools: ['project_overview', 'read_requirement', 'search_cases', 'generate_cases', 'update_case'],
  },
  reviewer: {
    label: '质量审查员', icon: '🔍',
    description: '检查原文依据、步骤、预期、引用覆盖和重复项，输出问题及修改建议；不新增、修改用例，不代替人工评审。',
    tools: ['project_overview', 'read_requirement', 'search_cases', 'check_coverage', 'review_cases'],
  },
} as const satisfies Record<AgentRole, { label: string; icon: string; description: string; tools: readonly string[] | null }>
