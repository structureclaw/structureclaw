'use client'

import dynamic from 'next/dynamic'
import { ThemeProvider } from '@/components/theme-provider'
import { AppStoreProvider } from '@/lib/stores'

const ClientToaster = dynamic(
  () => import('@/components/ui/toast').then((mod) => mod.Toaster),
  { ssr: false }
)

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
        <ClientToaster />
      </ThemeProvider>
    </AppStoreProvider>
  )
}
