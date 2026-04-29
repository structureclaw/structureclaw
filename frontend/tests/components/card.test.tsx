import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'

describe('Card Component (COMP-02)', () => {
  describe('Card', () => {
    it('Card renders children inside div', () => {
      render(
        <Card data-testid="card">
          <span>Child content</span>
        </Card>
      )
      const card = screen.getByTestId('card')
      expect(card).toBeInTheDocument()
      expect(card.tagName).toBe('DIV')
      expect(card).toHaveTextContent('Child content')
    })

    it('Card has rounded-lg border bg-card shadow-xs classes', () => {
      render(<Card data-testid="card">Content</Card>)
      const card = screen.getByTestId('card')
      expect(card).toHaveClass('rounded-lg')
      expect(card).toHaveClass('border')
      expect(card).toHaveClass('bg-card')
      expect(card).toHaveClass('shadow-xs')
    })

    it('Card forwards ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<Card ref={ref}>Content</Card>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })
  })

  describe('CardHeader', () => {
    it('CardHeader has flex flex-col space-y-1.5 p-6', () => {
      render(<CardHeader data-testid="header">Header</CardHeader>)
      const header = screen.getByTestId('header')
      expect(header).toHaveClass('flex')
      expect(header).toHaveClass('flex-col')
      expect(header).toHaveClass('space-y-1.5')
      expect(header).toHaveClass('p-6')
    })

    it('CardHeader forwards ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<CardHeader ref={ref}>Header</CardHeader>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })
  })

  describe('CardTitle', () => {
    it('CardTitle renders h3 with text-2xl font-semibold', () => {
      render(<CardTitle>Card Title</CardTitle>)
      const title = screen.getByRole('heading', { level: 3 })
      expect(title).toBeInTheDocument()
      expect(title).toHaveTextContent('Card Title')
      expect(title).toHaveClass('text-2xl')
      expect(title).toHaveClass('font-semibold')
    })

    it('CardTitle forwards ref correctly', () => {
      const ref = { current: null as HTMLHeadingElement | null }
      render(<CardTitle ref={ref}>Title</CardTitle>)
      expect(ref.current).toBeInstanceOf(HTMLHeadingElement)
    })
  })

  describe('CardDescription', () => {
    it('CardDescription renders p with text-muted-foreground', () => {
      render(<CardDescription>Description text</CardDescription>)
      const desc = screen.getByText('Description text')
      expect(desc.tagName).toBe('P')
      expect(desc).toHaveClass('text-muted-foreground')
    })

    it('CardDescription forwards ref correctly', () => {
      const ref = { current: null as HTMLParagraphElement | null }
      render(<CardDescription ref={ref}>Description</CardDescription>)
      expect(ref.current).toBeInstanceOf(HTMLParagraphElement)
    })
  })

  describe('CardContent', () => {
    it('CardContent has p-6 pt-0 padding', () => {
      render(<CardContent data-testid="content">Content</CardContent>)
      const content = screen.getByTestId('content')
      expect(content).toHaveClass('p-6')
      expect(content).toHaveClass('pt-0')
    })

    it('CardContent forwards ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<CardContent ref={ref}>Content</CardContent>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })
  })

  describe('CardFooter', () => {
    it('CardFooter has flex items-center p-6 pt-0', () => {
      render(<CardFooter data-testid="footer">Footer</CardFooter>)
      const footer = screen.getByTestId('footer')
      expect(footer).toHaveClass('flex')
      expect(footer).toHaveClass('items-center')
      expect(footer).toHaveClass('p-6')
      expect(footer).toHaveClass('pt-0')
    })

    it('CardFooter forwards ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<CardFooter ref={ref}>Footer</CardFooter>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })
  })
})
