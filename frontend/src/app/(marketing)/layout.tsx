'use client'

import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import Link from 'next/link'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_22%),linear-gradient(180deg,#020617_0%,#06101f_55%,#030712_100%)] text-white">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-sm font-semibold text-cyan-200">
            SC
          </span>
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">StructureClaw</div>
            <div className="text-sm text-slate-300">Conversational Engineering AI</div>
          </div>
        </Link>
        <nav className="flex items-center gap-4">
          <Link href="/console" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10">
            打开控制台
          </Link>
          <LanguageToggle />
          <ThemeToggle />
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}
