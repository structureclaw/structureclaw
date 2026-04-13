import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DatabaseAdminPage from '@/app/(console)/console/database/page'

describe('DatabaseAdminPage', () => {
  it('renders sqlite status details from real backend', async () => {
    render(<DatabaseAdminPage />)

    expect(await screen.findByRole('heading', { name: 'SQLite Database Status' })).toBeInTheDocument()
    await waitFor(() => {
      // Real backend returns the test database path (may appear as both file: URL and plain path)
      expect(screen.getAllByText(/test-vitest-integration\.db/).length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Writable')).toBeInTheDocument()
  })
})
