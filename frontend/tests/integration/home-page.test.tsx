import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from '@/app/(marketing)/page'

describe('Home Page Integration (PAGE-01)', () => {
  it('renders with main landmark', () => {
    render(<HomePage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders the current hero copy', () => {
    render(<HomePage />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('把结构分析工作台，改造成真正能对话的 AI。')
    expect(screen.getByText(/StructureClaw 现在以对话为主入口/)).toBeInTheDocument()
  })

  it('renders workflow prompts and feature cards', () => {
    render(<HomePage />)

    expect(screen.getByText('先告诉我建一个门式刚架模型需要哪些已知条件')).toBeInTheDocument()
    expect(screen.getByText('根据一段工程描述，先帮我判断适合静力还是动力分析')).toBeInTheDocument()
    expect(screen.getByText('先对话，再执行')).toBeInTheDocument()
    expect(screen.getByText('结果与报告分离呈现')).toBeInTheDocument()
    expect(screen.getByText('保留工程上下文')).toBeInTheDocument()
  })

  it('CTA button links to console', () => {
    render(<HomePage />)

    const ctaLink = screen.getByRole('link', { name: /进入 AI 控制台/i })
    expect(ctaLink).toHaveAttribute('href', '/console')
  })

  it('keeps the workflow anchor link', () => {
    render(<HomePage />)

    expect(screen.getByRole('link', { name: '查看工作流' })).toHaveAttribute('href', '#workflow')
  })

  it('all interactive elements are keyboard accessible', async () => {
    const user = userEvent.setup()
    render(<HomePage />)

    await user.tab()
    const ctaLink = screen.getByRole('link', { name: /进入 AI 控制台/i })
    expect(ctaLink).toHaveFocus()
  })

  it('renders the live workspace preview content', () => {
    render(<HomePage />)

    expect(screen.getByText('Live Workspace')).toBeInTheDocument()
    expect(screen.getByText('对话 + 结果双栏')).toBeInTheDocument()
    expect(screen.getByText(/我正在理解你的分析需求/)).toBeInTheDocument()
  })

  it('uses the new conversational positioning badge', () => {
    render(<HomePage />)

    expect(screen.getByText('Conversational Structural AI')).toBeInTheDocument()
  })
})
