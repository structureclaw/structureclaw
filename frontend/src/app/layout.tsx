import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { GeistSans, GeistMono } from '@/lib/fonts'

export const metadata: Metadata = {
  title: 'StructureClaw - Structural Engineering AI Console',
  description: 'StructureClaw frontend console for agent orchestration, chat routes, and structural analysis workflows.',
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
          {children}
        </Providers>
      </body>
    </html>
  )
}
