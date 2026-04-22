import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import { Providers } from './providers'
import { GeistSans, GeistMono } from '@/lib/fonts'
import { LOCALE_COOKIE_NAME, parseLocaleCookieValue } from '@/lib/locale-preference'

// Locale-aware SSR reads the preference cookie during the request, so this layout is intentionally dynamic.
export const dynamic = 'force-dynamic'

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
  const initialLocale = parseLocaleCookieValue(cookies().get(LOCALE_COOKIE_NAME)?.value)
  const htmlLang = initialLocale === 'zh' ? 'zh-CN' : 'en'

  return (
    <html lang={htmlLang} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers initialLocale={initialLocale}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
