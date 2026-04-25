'use client'

import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import { WorkspaceSettingsDialog } from '@/components/settings/workspace-settings-dialog'
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
        <div className="flex w-full items-center justify-between gap-3 px-3 py-3 sm:px-5 xl:px-6 2xl:px-8">
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
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="w-full flex-1 min-h-0 py-2 sm:py-3 xl:overflow-y-auto xl:px-0">
        {children}
      </main>
      <WorkspaceSettingsDialog />
    </div>
  )
}
