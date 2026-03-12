'use client'

import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import { useI18n } from '@/lib/i18n'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { t } = useI18n()

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_20%),linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(241,245,249,0.95)_55%,rgba(226,232,240,0.92)_100%)] text-foreground dark:bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_22%),linear-gradient(180deg,#020617_0%,#06101f_55%,#030712_100%)] dark:text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/60 bg-background/80 px-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/60">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-sm font-semibold text-cyan-700 dark:text-cyan-200">
            SC
          </span>
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-700/80 dark:text-cyan-200/70">StructureClaw</div>
            <div className="text-sm text-muted-foreground">{t('marketingTagline')}</div>
          </div>
        </Link>
        <nav className="flex items-center gap-4">
          <Link href="/console" className="rounded-full border border-border bg-background/70 px-4 py-2 text-sm text-foreground transition hover:bg-accent/10 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10">
            {t('marketingOpenConsole')}
          </Link>
          <LanguageToggle />
          <ThemeToggle />
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}
