'use client'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toast'
import { AppStoreProvider } from '@/lib/stores'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppStoreProvider>
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
