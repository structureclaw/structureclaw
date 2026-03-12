'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme, theme } = useTheme()
  const { t } = useI18n()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  // Cycle through themes on click
  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'] as const
    const currentIndex = themes.indexOf(theme as (typeof themes)[number])
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  if (!mounted) {
    return (
      <button
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium',
          'transition-colors hover:bg-accent hover:text-accent-foreground',
          className
        )}
        disabled
      >
        <Sun className="h-5 w-5" />
        <span className="sr-only">{t('themeToggle')}</span>
      </button>
    )
  }

  const currentThemeLabel =
    theme === 'light' ? t('light') : theme === 'dark' ? t('dark') : t('system')

  return (
    <button
      onClick={cycleTheme}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium',
        'transition-colors hover:bg-accent hover:text-accent-foreground',
          className
        )}
      title={`${t('themeCurrent')}: ${currentThemeLabel}`}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">{`${t('themeToggle')} (${t('themeCurrent')}: ${currentThemeLabel})`}</span>
    </button>
  )
}
