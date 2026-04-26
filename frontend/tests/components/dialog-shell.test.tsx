import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DialogShell } from '@/components/ui/dialog-shell'

describe('DialogShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.style.overflow = ''
  })

  it('renders dialog content through a portal and closes on Escape', () => {
    const onClose = vi.fn()

    render(
      <DialogShell
        open
        title="Workspace Settings"
        closeLabel="Close"
        onClose={onClose}
      >
        <button type="button">Focusable action</button>
      </DialogShell>
    )

    expect(screen.getByRole('dialog', { name: 'Workspace Settings' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when clicking outside the dialog without closing on inside clicks', () => {
    const onClose = vi.fn()

    render(
      <DialogShell
        open
        title="Workspace Settings"
        closeLabel="Close"
        onClose={onClose}
      >
        <button type="button">Focusable action</button>
      </DialogShell>
    )

    const dialog = screen.getByRole('dialog', { name: 'Workspace Settings' })
    const outsideLayer = dialog.parentElement
    expect(outsideLayer).not.toBeNull()

    // Click inside dialog should not close
    fireEvent.pointerDown(dialog, { button: 0 })
    fireEvent.pointerUp(dialog, { button: 0 })
    expect(onClose).not.toHaveBeenCalled()

    // Complete pointerDown + pointerUp on overlay should close
    fireEvent.pointerDown(outsideLayer as HTMLElement, { button: 0 })
    fireEvent.pointerUp(outsideLayer as HTMLElement, { button: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores body scroll and previous focus when closed', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    opener.type = 'button'
    document.body.appendChild(opener)
    opener.focus()
    document.body.style.overflow = 'auto'

    const { unmount } = render(
      <DialogShell
        open
        title="Workspace Settings"
        closeLabel="Close"
        onClose={onClose}
      >
        <button type="button">Focusable action</button>
      </DialogShell>
    )

    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: /Close/i })).toHaveFocus()

    unmount()

    expect(document.body.style.overflow).toBe('auto')
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('loops focus through dialog controls with Tab and Shift+Tab', () => {
    const onClose = vi.fn()

    render(
      <DialogShell
        open
        title="Workspace Settings"
        closeLabel="Close"
        onClose={onClose}
      >
        <button type="button">Focusable action</button>
      </DialogShell>
    )

    const closeButton = screen.getByRole('button', { name: /Close/i })
    const actionButton = screen.getByRole('button', { name: 'Focusable action' })

    actionButton.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(closeButton).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(actionButton).toHaveFocus()
  })

  it('uses the visible title and description for accessible dialog labelling', () => {
    render(
      <DialogShell
        open
        title="Workspace Settings"
        closeLabel="Close"
        description="Configure workspace capabilities"
        onClose={() => undefined}
      >
        <button type="button">Focusable action</button>
      </DialogShell>
    )

    const dialog = screen.getByRole('dialog', {
      name: 'Workspace Settings',
      description: 'Configure workspace capabilities',
    })
    const title = screen.getByText('Workspace Settings')
    const description = screen.getByText('Configure workspace capabilities')

    expect(dialog).toHaveAttribute('aria-labelledby', title.id)
    expect(dialog).toHaveAttribute('aria-describedby', description.id)
    expect(dialog).not.toHaveAttribute('aria-label')
  })

  it('returns null when closed', () => {
    render(
      <DialogShell
        open={false}
        title="Hidden Dialog"
        closeLabel="Close"
        onClose={() => undefined}
      >
        Hidden
      </DialogShell>
    )

    expect(screen.queryByRole('dialog', { name: 'Hidden Dialog' })).not.toBeInTheDocument()
  })
})
