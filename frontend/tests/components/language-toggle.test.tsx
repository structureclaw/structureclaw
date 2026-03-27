import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { clearLocaleCookie } from '@/lib/locale-preference'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import { LanguageToggle } from '@/components/language-toggle'

const switchToEnglishName = /switch language to english|切换语言为英文/i
const switchToChineseName = /switch language to chinese|切换语言为中文/i

describe('LanguageToggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearLocaleCookie()
    document.documentElement.lang = 'en'
  })

  it('defaults to EN in a fresh store', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    const englishButton = screen.getByRole('button', { name: switchToEnglishName })
    expect(englishButton).toBeInTheDocument()
  })

  it('updates locale to zh when Chinese button is clicked', () => {
    function LocaleReader() {
      const locale = useStore((state) => state.locale)
      return <span data-testid="locale-value">{locale}</span>
    }

    render(
      <AppStoreProvider>
        <LanguageToggle />
        <LocaleReader />
      </AppStoreProvider>
    )

    const chineseButton = screen.getByRole('button', { name: switchToChineseName })
    fireEvent.click(chineseButton)

    expect(screen.getByTestId('locale-value')).toHaveTextContent('zh')
  })

  it('updates document language when locale changes', async () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: switchToChineseName }))

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('zh-CN')
    })
  })
})
