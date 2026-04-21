'use client'

import 'katex/dist/katex.min.css'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import { cn } from '@/lib/utils'
import { API_BASE } from '@/lib/api-base'

const MARKDOWN_BODY_BASE_CLASS = 'prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-code:text-cyan-700 prose-pre:bg-muted/60 prose-a:text-cyan-700 prose-a:no-underline hover:prose-a:text-cyan-600 dark:prose-invert dark:prose-code:text-cyan-200 dark:prose-pre:bg-black/30 dark:prose-a:text-cyan-200 dark:hover:prose-a:text-cyan-100'
const MARKDOWN_BODY_COMPACT_CLASS = `${MARKDOWN_BODY_BASE_CLASS} prose-p:my-0`

function rewriteMarkdownUrl(url: string) {
  const safeUrl = defaultUrlTransform(url)
  return safeUrl.startsWith('/') ? `${API_BASE}${safeUrl}` : safeUrl
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, ...props }) => <a {...props} href={href} target="_blank" rel="noopener noreferrer" />,
  table: ({ children, ...props }) => (
    <div className="my-5 overflow-x-auto">
      <table {...props} className="w-full border border-border/70 dark:border-white/10">{children}</table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th {...props} className="border border-border/70 bg-background/70 px-3 py-2 text-left text-foreground dark:border-white/10 dark:bg-white/5">{children}</th>
  ),
  td: ({ children, ...props }) => (
    <td {...props} className="border border-border/50 px-3 py-2 text-muted-foreground dark:border-white/10">{children}</td>
  ),
}

export function MarkdownBody({
  content,
  className,
  compact = false,
}: {
  content: string
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn(compact ? MARKDOWN_BODY_COMPACT_CLASS : MARKDOWN_BODY_BASE_CLASS, className)}>
      <ReactMarkdown
        components={MARKDOWN_COMPONENTS}
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={rewriteMarkdownUrl}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
