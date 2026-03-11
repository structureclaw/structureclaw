'use client'

import Link from 'next/link'
import { ArrowRight, Bot, BrainCircuit, FileSearch, Radar, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const features = [
  {
    icon: BrainCircuit,
    title: '先对话，再执行',
    description: '先像与资深结构工程师沟通一样澄清需求，再在合适时机进入分析执行。',
  },
  {
    icon: Radar,
    title: '结果与报告分离呈现',
    description: '右侧工作区持续展示最新分析结果与 Markdown 报告，避免信息混杂。',
  },
  {
    icon: FileSearch,
    title: '保留工程上下文',
    description: '模型 JSON、分析类型、规范约束被收敛到上下文区，不再占据主界面焦点。',
  },
]

const prompts = [
  '先告诉我建一个门式刚架模型需要哪些已知条件',
  '根据一段工程描述，先帮我判断适合静力还是动力分析',
  '拿到模型 JSON 后直接执行，并输出可读报告',
]

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.16),transparent_24%),radial-gradient(circle_at_80%_15%,rgba(249,115,22,0.14),transparent_18%),radial-gradient(circle_at_50%_80%,rgba(56,189,248,0.12),transparent_28%)]" />

      <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-7xl flex-col justify-center px-6 py-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100" variant="outline">
              Conversational Structural AI
            </Badge>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-tight tracking-tight text-white sm:text-6xl">
              把结构分析工作台，改造成真正能对话的 AI。
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              StructureClaw 现在以对话为主入口。你先描述目标、工况、边界条件和不确定点，AI 帮你厘清问题；当模型准备好后，再进入分析与报告输出。
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/console">
                <Button size="lg" className="rounded-full bg-cyan-300 px-7 text-slate-950 hover:bg-cyan-200">
                  进入 AI 控制台
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a
                href="#workflow"
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm text-slate-200 transition hover:bg-white/10"
              >
                查看工作流
              </a>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {prompts.map((prompt) => (
                <div key={prompt} className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <Sparkles className="mb-3 h-4 w-4 text-cyan-300" />
                  {prompt}
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative rounded-[32px] border border-white/10 bg-slate-950/70 p-5 shadow-[0_30px_90px_-30px_rgba(34,211,238,0.45)] backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Live Workspace</div>
                  <div className="mt-1 text-lg font-semibold text-white">对话 + 结果双栏</div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  深色 AI 控制台
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 flex items-center gap-3 text-sm text-slate-300">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                      <Bot className="h-4 w-4" />
                    </span>
                    先通过对话澄清结构目标、荷载、边界条件和规范要求。
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-400">
                    “我正在理解你的分析需求。准备好模型后，可以直接执行分析并生成报告。”
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 text-sm font-medium text-white">结果面板</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Analysis</div>
                      <div className="mt-3 text-sm text-slate-300">位移、内力、工况和摘要统计集中展示。</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Report</div>
                      <div className="mt-3 text-sm text-slate-300">Markdown 报告单独呈现，适合复核与交付。</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="relative mx-auto max-w-7xl px-6 pb-20">
        <div className="grid gap-6 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="border-white/10 bg-slate-950/60 text-slate-100 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                    <feature.icon className="h-5 w-5" />
                  </span>
                  {feature.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-7 text-slate-400">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  )
}
