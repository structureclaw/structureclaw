import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppStoreProvider, useStore, createAppStore, initStore } from '@/lib/stores/context'

describe('Store Context (STAT-01)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('AppStoreProvider renders children without error', () => {
    render(
      <AppStoreProvider>
        <div>Child Content</div>
      </AppStoreProvider>
    )
    expect(screen.getByText('Child Content')).toBeInTheDocument()
  })

  it('useStore throws error when used outside AppStoreProvider', () => {
    function TestComponent() {
      try {
        useStore((state) => state.locale)
        return <div>No Error</div>
      } catch (e) {
        return <div>Error: {(e as Error).message}</div>
      }
    }

    render(<TestComponent />)
    expect(screen.getByText(/Error:/)).toBeInTheDocument()
    expect(screen.getByText(/useStore must be used within AppStoreProvider/)).toBeInTheDocument()
  })

  it('useStore returns selected state from store', () => {
    function TestComponent() {
      const locale = useStore((state) => state.locale)
      return <div data-testid="locale">{locale}</div>
    }

    render(
      <AppStoreProvider>
        <TestComponent />
      </AppStoreProvider>
    )

    expect(screen.getByTestId('locale')).toHaveTextContent('en')
  })

  it('Multiple components share same store instance within provider', () => {
    function ComponentA() {
      const locale = useStore((state) => state.locale)
      return <div data-testid="locale-a">{locale}</div>
    }

    function ComponentB() {
      const locale = useStore((state) => state.locale)
      return <div data-testid="locale-b">{locale}</div>
    }

    render(
      <AppStoreProvider>
        <ComponentA />
        <ComponentB />
      </AppStoreProvider>
    )

    expect(screen.getByTestId('locale-a')).toHaveTextContent('en')
    expect(screen.getByTestId('locale-b')).toHaveTextContent('en')
  })

  it('Store state updates propagate to all consumers', async () => {
    function SetterComponent() {
      // Use separate selectors to avoid object reference instability with React 19
      const locale = useStore((state) => state.locale)
      const setLocale = useStore((state) => state.setLocale)
      return (
        <button onClick={() => setLocale('zh')} data-testid="setter">
          Set Locale: {locale}
        </button>
      )
    }

    function ReaderComponent() {
      const locale = useStore((state) => state.locale)
      return <div data-testid="reader">{locale}</div>
    }

    render(
      <AppStoreProvider>
        <SetterComponent />
        <ReaderComponent />
      </AppStoreProvider>
    )

    expect(screen.getByTestId('setter')).toHaveTextContent('Set Locale: en')
    expect(screen.getByTestId('reader')).toHaveTextContent('en')
    fireEvent.click(screen.getByTestId('setter'))

    await waitFor(() => {
      expect(screen.getByTestId('setter')).toHaveTextContent('Set Locale: zh')
      expect(screen.getByTestId('reader')).toHaveTextContent('zh')
    })
  })
})

describe('createAppStore and initStore', () => {
  it('initStore returns correct initial state', () => {
    const state = initStore()
    expect(state.locale).toBe('en')
  })

  it('createAppStore creates a store with initial state', () => {
    const store = createAppStore()
    const state = store.getState()
    expect(state.locale).toBe('en')
  })

  it('createAppStore accepts custom initial state', () => {
    const store = createAppStore({ locale: 'zh' })
    const state = store.getState()

    expect(state.locale).toBe('zh')
  })

  it('store actions work correctly', () => {
    const store = createAppStore()

    store.getState().setLocale('zh')
    expect(store.getState().locale).toBe('zh')
  })
})
