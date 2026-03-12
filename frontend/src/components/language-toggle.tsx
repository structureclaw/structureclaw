'use client'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-input bg-background p-1',
        className
      )}
      role="group"
      aria-label={t('language')}
    >
      <Button
        size="sm"
        variant={locale === 'en' ? 'default' : 'ghost'}
        className="h-7 px-2"
        onClick={() => setLocale('en')}
        aria-label={t('switchLanguageToEnglish')}
      >
        {t('english')}
      </Button>
      <Button
        size="sm"
        variant={locale === 'zh' ? 'default' : 'ghost'}
        className="h-7 px-2"
        onClick={() => setLocale('zh')}
        aria-label={t('switchLanguageToChinese')}
      >
        {t('chinese')}
      </Button>
    </div>
  )
}
