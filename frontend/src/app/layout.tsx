import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { GeistSans, GeistMono } from '@/lib/fonts'
import { WorkspaceSettingsDialog } from '@/components/settings/workspace-settings-dialog'

export const metadata: Metadata = {
  title: 'StructureClaw - Structural Engineering AI Console',
  description: 'StructureClaw frontend console for AI-powered structural analysis workflows.',
  keywords: ['结构分析', '有限元', '结构设计', 'Agent', 'Chat', 'OpenSees'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <div className="min-h-screen flex flex-col bg-slate-50/95 text-foreground xl:h-screen xl:overflow-hidden dark:bg-slate-950/95 dark:text-foreground">
            <main className="w-full flex-1 min-h-0 xl:overflow-y-auto">
              {children}
            </main>
            <WorkspaceSettingsDialog />
          </div>
        </Providers>
      </body>
    </html>
  )
}
