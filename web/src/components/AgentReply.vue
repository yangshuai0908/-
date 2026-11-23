<script setup lang="ts">
import { computed } from 'vue'
import { renderAgentReply } from '../modules/agent/reply'
import PathwayViewer, { type PathwayData } from './PathwayViewer.vue'

const props = defineProps<{ content: string }>()

const parsedPathway = computed<PathwayData | null>(() => {
  const text = props.content.trim()
  if (!text.includes('coreHappyPath') && !text.includes('stateMachine')) {
    return null
  }
  // Case 1: direct JSON string
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const obj = JSON.parse(text)
      if (obj.coreHappyPath || obj.stateMachine) {
        return obj
      }
    } catch {}
  }
  // Case 2: fenced code block ```json { ... } ```
  const match = text.match(/```(?:json)?\s*(\{[\s\S]*?"coreHappyPath"[\s\S]*?\})\s*```/)
  if (match) {
    try {
      const obj = JSON.parse(match[1])
      if (obj.coreHappyPath || obj.stateMachine) {
        return obj
      }
    } catch {}
  }
  // Case 3: JSON embedded inside markdown text
  const braceStart = text.indexOf('{')
  const braceEnd = text.lastIndexOf('}')
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      const sub = text.slice(braceStart, braceEnd + 1)
      const obj = JSON.parse(sub)
      if (obj.coreHappyPath || obj.stateMachine) {
        return obj
      }
    } catch {}
  }
  return null
})

const html = computed(() => {
  if (parsedPathway.value) return ''
  return renderAgentReply(props.content)
})
</script>

<template>
  <PathwayViewer v-if="parsedPathway" :data="parsedPathway" />
  <div v-else class="agent-reply" v-html="html" />
</template>

<style scoped>
.agent-reply {
  color: #334155;
  font-size: 14px;
  line-height: 1.85;
  white-space: normal;
  overflow-wrap: anywhere;
}
.agent-reply :deep(> :first-child) { margin-top: 0; }
.agent-reply :deep(> :last-child) { margin-bottom: 0; }
.agent-reply :deep(p) { margin: 0 0 12px; }
.agent-reply :deep(h1),
.agent-reply :deep(h2),
.agent-reply :deep(h3),
.agent-reply :deep(h4),
.agent-reply :deep(h5),
.agent-reply :deep(h6) { margin: 20px 0 8px; font-size: 14px; line-height: 1.6; color: #1e293b; }
.agent-reply :deep(ul),
.agent-reply :deep(ol) { margin: 10px 0 16px; padding-left: 24px; }
.agent-reply :deep(li) { margin: 0 0 10px; padding-left: 4px; }
.agent-reply :deep(li::marker) { color: #64748b; font-weight: 600; }
.agent-reply :deep(li > p) { margin-bottom: 6px; }
.agent-reply :deep(> ol > li),
.agent-reply :deep(> ul > li) {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #e6ebf1;
  border-radius: 8px;
  background: #f8fafc;
}
.agent-reply :deep(li > :last-child) { margin-bottom: 0; }
.agent-reply :deep(> ol > li > p > strong:first-child),
.agent-reply :deep(> ul > li > p > strong:first-child),
.agent-reply :deep(> ol > li > strong:first-child),
.agent-reply :deep(> ul > li > strong:first-child) { color: #243b53; }
.agent-reply :deep(strong) { font-weight: 650; color: #1e293b; }
.agent-reply :deep(code) { padding: 2px 5px; border-radius: 4px; background: #f1f5f9; font-size: 12px; }
.agent-reply :deep(pre) { max-width: 100%; overflow: auto; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; white-space: pre; }
.agent-reply :deep(pre code) { padding: 0; background: none; }
.agent-reply :deep(blockquote) { margin: 12px 0; padding: 0 12px; border-left: 3px solid #cbd5e1; color: #64748b; }
.agent-reply :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
.agent-reply :deep(th),
.agent-reply :deep(td) { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
.agent-reply :deep(th) { background: #f8fafc; }
.agent-reply :deep(a) { color: #456b91; text-decoration: underline; text-underline-offset: 3px; }
</style>
