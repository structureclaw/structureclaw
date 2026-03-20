import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DatabaseAdminPage from '@/app/(console)/console/database/page'

describe('DatabaseAdminPage', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url.includes('/api/v1/admin/database/status')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            enabled: true,
            provider: 'sqlite',
            mode: 'local-file',
            database: {
              provider: 'sqlite',
              databaseUrl: 'file:/workspace/.runtime/data/structureclaw.db',
              databasePath: '/workspace/.runtime/data/structureclaw.db',
              directoryPath: '/workspace/.runtime/data',
              exists: true,
              writable: true,
              sizeBytes: 32768,
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders sqlite status details', async () => {
    render(<DatabaseAdminPage />)

    expect(await screen.findByRole('heading', { name: 'SQLite Database Status' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/database/status'), { cache: 'no-store' })
    })

    expect(screen.getByText('/workspace/.runtime/data/structureclaw.db')).toBeInTheDocument()
    expect(screen.getByText('file:/workspace/.runtime/data/structureclaw.db')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Writable')).toBeInTheDocument()
  })
})
