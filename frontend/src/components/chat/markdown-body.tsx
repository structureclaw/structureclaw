'use client'

import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const MARKDOWN_BODY_BASE_CLASS = 'prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-code:text-cyan-700 prose-pre:bg-muted/60 prose-a:text-cyan-700 prose-a:no-underline hover:prose-a:text-cyan-600 prose-table:my-4 prose-table:w-full prose-th:border prose-th:border-border/70 prose-th:bg-background/70 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-foreground prose-td:border prose-td:border-border/50 prose-td:px-3 prose-td:py-2 prose-td:text-muted-foreground dark:prose-invert dark:prose-code:text-cyan-200 dark:prose-pre:bg-black/30 dark:prose-a:text-cyan-200 dark:hover:prose-a:text-cyan-100 dark:prose-th:border-white/10 dark:prose-th:bg-white/5 dark:prose-td:border-white/10'
const MARKDOWN_BODY_COMPACT_CLASS = `${MARKDOWN_BODY_BASE_CLASS} prose-p:my-0`

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ''

function rewriteMarkdownUrl(url: string) {
  const safeUrl = defaultUrlTransform(url)
  return safeUrl.startsWith('/') ? `${API_BASE}${safeUrl}` : safeUrl
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, ...props }) => <a {...props} href={href} target="_blank" rel="noopener noreferrer" />,
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
      <ReactMarkdown components={MARKDOWN_COMPONENTS} remarkPlugins={[remarkGfm]} urlTransform={rewriteMarkdownUrl}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
