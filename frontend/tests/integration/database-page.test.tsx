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
            provider: 'pgadmin',
            url: 'http://localhost:5050',
            defaultEmail: 'admin@structureclaw.local',
            database: {
              host: 'postgres',
              port: '5432',
              database: 'structureclaw',
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

  it('renders pgAdmin access details', async () => {
    render(<DatabaseAdminPage />)

    expect(await screen.findByRole('heading', { name: 'Database Visual Admin' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/database/status'), { cache: 'no-store' })
    })

    expect(screen.getByRole('link', { name: 'Open pgAdmin' })).toHaveAttribute('href', 'http://localhost:5050')
    expect(screen.getByText('postgres:5432 / structureclaw')).toBeInTheDocument()
    expect(screen.getByText('admin@structureclaw.local')).toBeInTheDocument()
  })
})
