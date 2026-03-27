'use client'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toast'
import { AppStoreProvider } from '@/lib/stores'
import type { AppLocale } from '@/lib/stores/slices/preferences'

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
        <Toaster />
      </ThemeProvider>
    </AppStoreProvider>
  )
}
