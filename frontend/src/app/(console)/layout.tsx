'use client'

import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import { useI18n } from '@/lib/i18n'

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { t } = useI18n()

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_20%),radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.1),transparent_20%),linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(241,245,249,0.95)_55%,rgba(226,232,240,0.92)_100%)] text-foreground xl:h-screen xl:overflow-hidden dark:bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.15),transparent_22%),radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.12),transparent_20%),linear-gradient(180deg,#020617_0%,#06101f_55%,#030712_100%)] dark:text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6 xl:px-8 2xl:px-10">
          <div className="flex items-center gap-4">
            <Link href="/" className="inline-flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-700 dark:text-cyan-200">
                SC
              </span>
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">StructureClaw</div>
                <div className="text-sm text-muted-foreground">{t('marketingTagline')}</div>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-[20px] border border-border/70 bg-background/70 px-2 py-2 dark:border-white/10 dark:bg-white/5">
              <span className="px-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {t('settingsNav')}
              </span>
              <Link
                href="/console/capabilities"
                className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-800 transition hover:bg-cyan-300/20 dark:text-cyan-100"
              >
                {t('capabilitySettingsNav')}
              </Link>
              <Link
                href="/console/llm"
                className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-800 transition hover:bg-cyan-300/20 dark:text-cyan-100"
              >
                {t('llmSettingsNav')}
              </Link>
              <Link
                href="/console/database"
                className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-800 transition hover:bg-cyan-300/20 dark:text-cyan-100"
              >
                {t('databaseAdminNav')}
              </Link>
            </div>
            <Link
              href="/console"
              className="rounded-full border border-border bg-background/70 px-4 py-2 text-sm text-foreground transition hover:bg-accent/10 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t('console')}
            </Link>
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="w-full flex-1 min-h-0 px-4 py-4 sm:px-6 sm:py-6 xl:overflow-y-auto xl:px-8 2xl:px-10">
        {children}
      </main>
    </div>
  )
}
