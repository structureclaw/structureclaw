'use client'

import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { WorkspaceSettingsDialog } from '@/components/settings/workspace-settings-dialog'

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_20%),radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.1),transparent_20%),linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(241,245,249,0.95)_55%,rgba(226,232,240,0.92)_100%)] text-foreground xl:h-screen xl:overflow-hidden dark:bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.15),transparent_22%),radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.12),transparent_20%),linear-gradient(180deg,#020617_0%,#06101f_55%,#030712_100%)] dark:text-foreground">
      <div className="fixed top-3 right-3 z-30 flex items-center gap-1.5">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <main className="w-full flex-1 min-h-0 xl:overflow-y-auto">
        {children}
      </main>
      <WorkspaceSettingsDialog />
    </div>
  )
}
