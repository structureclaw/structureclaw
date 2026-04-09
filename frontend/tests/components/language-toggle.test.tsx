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

  it('updates locale to en when English button is clicked from zh', () => {
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

    // Switch to Chinese first
    fireEvent.click(screen.getByRole('button', { name: switchToChineseName }))
    expect(screen.getByTestId('locale-value')).toHaveTextContent('zh')

    // Switch back to English (covers line 23: onClick={() => setLocale('en')})
    fireEvent.click(screen.getByRole('button', { name: switchToEnglishName }))
    expect(screen.getByTestId('locale-value')).toHaveTextContent('en')
  })

  it('restores document language to en when switching back from zh', async () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: switchToChineseName }))
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('zh-CN')
    })

    fireEvent.click(screen.getByRole('button', { name: switchToEnglishName }))
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en')
    })
  })

  it('applies default variant to the active locale button and ghost to the other', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    const englishButton = screen.getByRole('button', { name: switchToEnglishName })
    const chineseButton = screen.getByRole('button', { name: switchToChineseName })

    // Default locale is 'en', so English button should have default variant (bg-primary)
    expect(englishButton).toHaveClass('bg-primary')
    // Chinese button should have ghost variant (hover:bg-accent)
    expect(chineseButton).toHaveClass('hover:bg-accent')
    expect(chineseButton).not.toHaveClass('bg-primary')
  })

  it('swaps button variants after switching locale to zh', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    const englishButton = screen.getByRole('button', { name: switchToEnglishName })
    const chineseButton = screen.getByRole('button', { name: switchToChineseName })

    // Switch to Chinese
    fireEvent.click(chineseButton)

    // Now Chinese button should have default variant (bg-primary)
    expect(chineseButton).toHaveClass('bg-primary')
    // English button should have ghost variant
    expect(englishButton).toHaveClass('hover:bg-accent')
    expect(englishButton).not.toHaveClass('bg-primary')
  })

  it('renders group container with correct role and aria-label', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    const group = screen.getByRole('group')
    expect(group).toHaveAttribute('aria-label', 'Language')
  })

  it('renders button text labels for both languages', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    expect(screen.getByRole('button', { name: switchToEnglishName })).toHaveTextContent('EN')
    expect(screen.getByRole('button', { name: switchToChineseName })).toHaveTextContent('中文')
  })

  it('applies custom className to the wrapper div', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle className="custom-class" />
      </AppStoreProvider>
    )

    const group = screen.getByRole('group')
    expect(group).toHaveClass('custom-class')
  })

  it('renders without className prop without errors', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    const group = screen.getByRole('group')
    expect(group).toBeInTheDocument()
    expect(group).toHaveClass('inline-flex')
  })

  it('shows translated labels when locale is zh', () => {
    render(
      <AppStoreProvider>
        <LanguageToggle />
      </AppStoreProvider>
    )

    // Switch to Chinese to see translated aria-labels
    fireEvent.click(screen.getByRole('button', { name: switchToChineseName }))

    const group = screen.getByRole('group')
    expect(group).toHaveAttribute('aria-label', '语言')
  })
})
