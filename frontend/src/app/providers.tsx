'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { ThemeProvider } from '@/components/theme-provider'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import { readLocaleCookieFromDocument } from '@/lib/locale-preference'

const ClientToaster = dynamic(
  () => import('@/components/ui/toast').then((mod) => mod.Toaster),
  { ssr: false }
)

function LocaleSync({ children }: { children: React.ReactNode }) {
  const setLocale = useStore((s) => s.setLocale)

  useEffect(() => {
    const saved = readLocaleCookieFromDocument()
    if (saved) {
      setLocale(saved)
      document.documentElement.lang = saved === 'zh' ? 'zh-CN' : 'en'
    }
  }, [setLocale])

  return <>{children}</>
}

export function Providers({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AppStoreProvider initialState={{ locale: 'en' }}>
      <LocaleSync>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <ClientToaster />
        </ThemeProvider>
      </LocaleSync>
    </AppStoreProvider>
  )
}
