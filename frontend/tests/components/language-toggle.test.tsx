import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import { LanguageToggle } from '@/components/language-toggle'

describe('LanguageToggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it('defaults to EN in a fresh store', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    const englishButton = screen.getByRole('button', { name: /switch language to english/i })
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

    const chineseButton = screen.getByRole('button', { name: /switch language to chinese/i })
    fireEvent.click(chineseButton)

    expect(screen.getByTestId('locale-value')).toHaveTextContent('zh')
  })

  it('updates document language when locale changes', async () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /switch language to chinese/i }))

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('zh-CN')
    })
  })
})
