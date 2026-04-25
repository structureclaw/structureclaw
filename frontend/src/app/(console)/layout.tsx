'use client'

import { WorkspaceSettingsDialog } from '@/components/settings/workspace-settings-dialog'

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50/95 text-foreground xl:h-screen xl:overflow-hidden dark:bg-slate-950/95 dark:text-foreground">
      <main className="w-full flex-1 min-h-0 xl:overflow-y-auto">
        {children}
      </main>
      <WorkspaceSettingsDialog />
    </div>
  )
}
