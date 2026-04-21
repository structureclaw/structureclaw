import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LlmSettingsPage from '@/app/(console)/console/llm/page'

function runtimePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
    hasApiKey: true,
    apiKeyMasked: '********',
    hasOverrides: true,
    baseUrlSource: 'runtime',
    modelSource: 'runtime',
    apiKeySource: 'runtime',
    ...overrides,
  }
}

describe('LlmSettingsPage', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the saved global LLM settings with a masked token', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(runtimePayload()),
    } as unknown as Response)

    render(<LlmSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'LLM Settings' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://api.example.com/v1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeInTheDocument()
    expect(screen.getByDisplayValue('********')).toBeInTheDocument()
  })

  it('preserves the existing token when the masked value is left unchanged', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(runtimePayload()),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(runtimePayload({ model: 'gpt-4.1-mini' })),
      } as unknown as Response)

    render(<LlmSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'LLM Settings' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4.1-mini' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const saveCall = fetchMock.mock.calls[1]
    expect(String(saveCall?.[0])).toMatch(/\/api\/v1\/admin\/llm$/)
    expect(saveCall?.[1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String((saveCall?.[1] as RequestInit | undefined)?.body))).toEqual({
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4.1-mini',
      apiKeyMode: 'keep',
    })
  })

  it('falls back to the .env token when the user explicitly chooses it', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(runtimePayload()),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(runtimePayload({
          apiKeySource: 'env',
        })),
      } as unknown as Response)

    render(<LlmSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'LLM Settings' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use .env Token' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const saveCall = fetchMock.mock.calls[1]
    expect(JSON.parse(String((saveCall?.[1] as RequestInit | undefined)?.body))).toEqual({
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      apiKeyMode: 'inherit',
    })
  })

  it('deletes all runtime overrides when the user resets back to .env defaults', async () => {
    const fetchMock = vi.mocked(globalThis.fetch)

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(runtimePayload({
          baseUrl: 'https://runtime.example.com/v1',
          model: 'gpt-4o-mini',
        })),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          baseUrl: 'https://env.example.com/v1',
          model: 'env-model',
          hasApiKey: true,
          apiKeyMasked: '********',
          hasOverrides: false,
          baseUrlSource: 'env',
          modelSource: 'env',
          apiKeySource: 'env',
        }),
      } as unknown as Response)

    render(<LlmSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'LLM Settings' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use .env Defaults' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const resetCall = fetchMock.mock.calls[1]
    expect(String(resetCall?.[0])).toMatch(/\/api\/v1\/admin\/llm$/)
    expect(resetCall?.[1]).toMatchObject({ method: 'DELETE' })
  })
})
