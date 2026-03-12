'use client'

import Link from 'next/link'
import { ArrowRight, Bot, BrainCircuit, FileSearch, Radar, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'

export default function HomePage() {
  const { t } = useI18n()

  const features = [
    {
      icon: BrainCircuit,
      title: t('marketingFeature1Title'),
      description: t('marketingFeature1Desc'),
    },
    {
      icon: Radar,
      title: t('marketingFeature2Title'),
      description: t('marketingFeature2Desc'),
    },
    {
      icon: FileSearch,
      title: t('marketingFeature3Title'),
      description: t('marketingFeature3Desc'),
    },
  ]

  const prompts = [t('marketingPrompt1'), t('marketingPrompt2'), t('marketingPrompt3')]

  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.2),transparent_24%),radial-gradient(circle_at_80%_15%,rgba(249,115,22,0.16),transparent_18%),radial-gradient(circle_at_50%_80%,rgba(56,189,248,0.14),transparent_28%)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.16),transparent_24%),radial-gradient(circle_at_80%_15%,rgba(249,115,22,0.14),transparent_18%),radial-gradient(circle_at_50%_80%,rgba(56,189,248,0.12),transparent_28%)]" />

      <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-7xl flex-col justify-center px-6 py-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <Badge className="border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-100" variant="outline">
              {t('marketingBadge')}
            </Badge>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-tight tracking-tight text-foreground sm:text-6xl">
              {t('marketingHeroTitle')}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              {t('marketingHeroBody')}
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/console">
                <Button size="lg" className="rounded-full bg-cyan-400 px-7 text-slate-950 hover:bg-cyan-300">
                  {t('marketingEnterConsole')}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a
                href="#workflow"
                className="inline-flex items-center rounded-full border border-border bg-background/70 px-6 py-3 text-sm text-foreground transition hover:bg-accent/10 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
              >
                {t('marketingViewWorkflow')}
              </a>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {prompts.map((prompt) => (
                <div key={prompt} className="rounded-3xl border border-border bg-card/80 p-4 text-sm text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
                  <Sparkles className="mb-3 h-4 w-4 text-cyan-500 dark:text-cyan-300" />
                  {prompt}
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-full bg-cyan-400/15 blur-3xl dark:bg-cyan-400/10" />
            <div className="relative rounded-[32px] border border-border/70 bg-card/85 p-5 shadow-[0_30px_90px_-30px_rgba(34,211,238,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70 dark:shadow-[0_30px_90px_-30px_rgba(34,211,238,0.45)]">
              <div className="flex items-center justify-between border-b border-border/70 pb-4 dark:border-white/10">
                <div>
                  <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">{t('marketingPreviewEyebrow')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{t('marketingPreviewTitle')}</div>
                </div>
                <div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/5">
                  {t('marketingPreviewMode')}
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                <div className="rounded-[28px] border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-700 dark:text-cyan-200">
                      <Bot className="h-4 w-4" />
                    </span>
                    {t('marketingPreviewChatBody')}
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/60 p-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-black/20">
                    {t('marketingPreviewChatQuote')}
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="mb-3 text-sm font-medium text-foreground">{t('marketingPreviewPanelTitle')}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border/70 bg-muted/60 p-4 dark:border-white/10 dark:bg-black/20">
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t('marketingPreviewAnalysisLabel')}</div>
                      <div className="mt-3 text-sm text-muted-foreground">{t('marketingPreviewAnalysisBody')}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/60 p-4 dark:border-white/10 dark:bg-black/20">
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t('marketingPreviewReportLabel')}</div>
                      <div className="mt-3 text-sm text-muted-foreground">{t('marketingPreviewReportBody')}</div>
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
            <Card key={feature.title} className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-700 dark:text-cyan-200">
                    <feature.icon className="h-5 w-5" />
                  </span>
                  {feature.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-7 text-muted-foreground">
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
