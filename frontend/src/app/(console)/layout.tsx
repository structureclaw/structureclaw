import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.15),transparent_22%),radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.12),transparent_20%),linear-gradient(180deg,#020617_0%,#06101f_55%,#030712_100%)] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="inline-flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                SC
              </span>
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">StructureClaw</div>
                <div className="text-sm text-slate-300">Conversational Engineering AI</div>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
            >
              返回首页
            </Link>
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  )
}
