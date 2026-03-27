'use client'

import dynamic from 'next/dynamic'
import { ThemeProvider } from '@/components/theme-provider'
import { AppStoreProvider } from '@/lib/stores'
import type { AppLocale } from '@/lib/stores/slices/preferences'

const ClientToaster = dynamic(
  () => import('@/components/ui/toast').then((mod) => mod.Toaster),
  { ssr: false }
)

export function Providers({
  children,
  initialLocale = 'en',
}: {
  children: React.ReactNode
  initialLocale?: AppLocale
}) {
  return (
    <AppStoreProvider initialState={{ locale: initialLocale }}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <ClientToaster />
      </ThemeProvider>
    </AppStoreProvider>
  )
}
