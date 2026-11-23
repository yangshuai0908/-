import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false, breaks: true })

export function renderAgentReply(content: string): string {
  // 兼容历史回复中挤在同一行的编号列表，保留代码内容。
  const formatted = content.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g)
    .map(part => {
      if (part.startsWith('`') || part.startsWith('~~~')) return part
      const marker = /(^|[ \t：:；;。！？])(\d{1,2})[.、．](?!\d)[ \t]*/gm
      const markers = [...part.matchAll(marker)]
      const text = markers.length > 1
        ? part.replace(marker, (_match, prefix: string, number: string) => `${prefix.trimEnd()}\n\n${number}. `)
        : part
      return text
        .replace(/^(\s*(?:\d+[.)]|[-*+])\s+)([^*`:\n：]{1,24})[：:][ \t]*/gm, '$1**$2**\n')
        .replace(/([。！？])(?=(?:当前(?:项目|需求|版本)|下一步|接下来|建议|我可以|有什么|请问))/g, '$1\n\n')
    }).join('')
  return markdown.render(formatted)
}
