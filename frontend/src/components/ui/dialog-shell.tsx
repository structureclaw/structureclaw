'use client'

import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type DialogShellProps = {
  open: boolean
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
  description?: string
  className?: string
  contentClassName?: string
}

export function DialogShell({
  open,
  title,
  closeLabel,
  onClose,
  children,
  description,
  className,
  contentClassName,
}: DialogShellProps) {
  const titleId = useId()
  const descriptionId = useId()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const lastActiveElementRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const pointerDownOnOverlayRef = useRef(false)

  function handleOverlayPointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerDownOnOverlayRef.current = event.button === 0 && event.target === event.currentTarget
  }

  function handleOverlayPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (pointerDownOnOverlayRef.current && event.button === 0 && event.target === event.currentTarget) {
      onClose()
    }
    pointerDownOnOverlayRef.current = false
  }

  function handleDialogPointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerDownOnOverlayRef.current = false
    event.stopPropagation()
  }

  useEffect(() => {
    if (!open) return

    lastActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !containerRef.current) return

      const focusable = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('disabled'))

      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      lastActiveElementRef.current?.focus()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-80">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs" />
      <div className="absolute inset-0 p-2 sm:p-4" onPointerDown={handleOverlayPointerDown} onPointerUp={handleOverlayPointerUp}>
        <div
          ref={containerRef}
          aria-describedby={description ? descriptionId : undefined}
          aria-labelledby={titleId}
          aria-modal="true"
          className={cn(
            'relative mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-border/70 bg-card/95 shadow-[0_40px_120px_-40px_rgba(8,145,178,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95',
            className
          )}
          onPointerDown={handleDialogPointerDown}
          role="dialog"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border/70 px-4 py-3 sm:px-5 sm:py-4 dark:border-white/10">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-foreground sm:text-xl">{title}</h2>
              {description ? <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
            </div>
            <Button
              ref={closeButtonRef}
              className="shrink-0 rounded-full"
              onClick={onClose}
              type="button"
              variant="outline"
            >
              <X className="h-4 w-4" />
              {closeLabel}
            </Button>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-auto p-4 sm:p-5', contentClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
