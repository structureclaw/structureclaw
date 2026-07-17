'use client'

import { Activity, BarChart3, CheckCircle2, FileCheck2, LineChart, Waves } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import type { ReactNode } from 'react'

type Translator = (key: MessageKey) => string

type SeismicVisualReportProps = {
  result: {
    analysis?: Record<string, unknown>
    codeCheck?: unknown
    model?: Record<string, unknown>
    report?: {
      json?: Record<string, unknown>
    }
  } | null
  t: Translator
  locale: AppLocale
}

type ChartPoint = {
  x: number
  y: number
}

type LineSeries = {
  name: string
  color: string
  points: ChartPoint[]
}

type BarItem = {
  label: string
  value: number
  color: string
}

type ChartMarker = {
  x: number
  y?: number
  label: string
  color: string
  labelDx?: number
  labelDy?: number
}

const SERIES_COLORS = ['#2563eb', '#0f766e', '#d97706', '#7c3aed', '#dc2626']

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function numberText(value: unknown, locale: AppLocale, maximumFractionDigits = 3) {
  const number = finiteNumber(value)
  if (number === null) return 'N/A'
  return number.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits,
  })
}

function percentText(value: unknown, locale: AppLocale, maximumFractionDigits = 1) {
  const number = finiteNumber(value)
  if (number === null) return 'N/A'
  return `${(number * 100).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits,
  })}%`
}

function driftText(value: unknown) {
  const number = finiteNumber(value)
  return number === null ? 'N/A' : number.toFixed(8)
}

function isPassingStatus(status: unknown) {
  const normalized = stringValue(status).replace(/-/g, '_').toLowerCase()
  return ['pass', 'passed', 'ok', 'success', 'satisfied', 'completed', 'not_required'].includes(normalized)
}

function dataRecord(result: SeismicVisualReportProps['result']) {
  const analysis = asRecord(result?.analysis)
  return asRecord(analysis?.data) ?? analysis
}

function reportJsonRecord(result: SeismicVisualReportProps['result']) {
  return asRecord(result?.report?.json)
}

function codeCheckRecord(result: SeismicVisualReportProps['result']) {
  const reportJson = reportJsonRecord(result)
  return asRecord(reportJson?.codeCheck) ?? asRecord(result?.codeCheck)
}

function codeCheckSummaryRecord(result: SeismicVisualReportProps['result']) {
  return asRecord(codeCheckRecord(result)?.summary)
}

function clauseTraceability(result: SeismicVisualReportProps['result']) {
  const reportJson = reportJsonRecord(result)
  const rows = asArray(reportJson?.clauseTraceability)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
  return rows
}

function chartPath(points: ChartPoint[], xScale: (value: number) => number, yScale: (value: number) => number) {
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`)
    .join(' ')
}

function LineSvg({
  series,
  markers = [],
  height = 260,
  yLabel,
  xLabel,
  symmetricY = false,
}: {
  series: LineSeries[]
  markers?: ChartMarker[]
  height?: number
  yLabel: string
  xLabel: string
  symmetricY?: boolean
}) {
  const allPoints = series.flatMap((item) => item.points)
  if (allPoints.length === 0) return null

  const xValues = allPoints.map((point) => point.x)
  const yValues = allPoints.map((point) => point.y)
  const xMin = Math.min(...xValues)
  const xMax = Math.max(...xValues)
  const rawYMin = Math.min(...yValues)
  const rawYMax = Math.max(...yValues)
  const yAbs = Math.max(Math.abs(rawYMin), Math.abs(rawYMax), 1e-9)
  const yMin = symmetricY ? -yAbs * 1.08 : Math.min(0, rawYMin)
  const yMax = symmetricY ? yAbs * 1.08 : rawYMax * 1.12
  const width = 760
  const margin = { left: 64, right: 24, top: 26, bottom: 48 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const xScale = (value: number) => margin.left + ((value - xMin) / (xMax - xMin || 1)) * plotWidth
  const yScale = (value: number) => margin.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight
  const gridY = 4
  const gridX = 5

  return (
    <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img">
      <rect width={width} height={height} rx="18" fill="#ffffff" />
      {Array.from({ length: gridX + 1 }).map((_, index) => {
        const x = margin.left + (index / gridX) * plotWidth
        const value = xMin + (index / gridX) * (xMax - xMin)
        return (
          <g key={`x-${index}`}>
            <line x1={x} y1={margin.top} x2={x} y2={margin.top + plotHeight} stroke="#e2e8f0" />
            <text x={x} y={height - 24} textAnchor="middle" fill="#64748b" fontSize="15">
              {Number.isFinite(value) ? value.toFixed(value < 1 ? 2 : 1) : ''}
            </text>
          </g>
        )
      })}
      {Array.from({ length: gridY + 1 }).map((_, index) => {
        const y = margin.top + (index / gridY) * plotHeight
        const value = yMax - (index / gridY) * (yMax - yMin)
        return (
          <g key={`y-${index}`}>
            <line x1={margin.left} y1={y} x2={margin.left + plotWidth} y2={y} stroke="#e2e8f0" />
            <text x={margin.left - 10} y={y + 5} textAnchor="end" fill="#64748b" fontSize="15">
              {Number.isFinite(value) ? value.toFixed(Math.abs(value) < 1 ? 3 : 1) : ''}
            </text>
          </g>
        )
      })}
      <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#334155" strokeWidth="2" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#334155" strokeWidth="2" />
      {series.map((item, index) => (
        <g key={item.name}>
          <path d={chartPath(item.points, xScale, yScale)} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <text x={width - 28} y={42 + index * 24} textAnchor="end" fill={item.color} fontSize="16" fontWeight="700">
            {item.name}
          </text>
        </g>
      ))}
      {markers.map((marker) => (
        <g key={`${marker.label}-${marker.x}`}>
          <line x1={xScale(marker.x)} y1={margin.top} x2={xScale(marker.x)} y2={margin.top + plotHeight} stroke={marker.color} strokeWidth="2" strokeDasharray="7 7" />
          {marker.y !== undefined ? <circle cx={xScale(marker.x)} cy={yScale(marker.y)} r="6" fill={marker.color} stroke="#ffffff" strokeWidth="3" /> : null}
          <text
            x={xScale(marker.x) + (marker.labelDx ?? 8)}
            y={(marker.y !== undefined ? yScale(marker.y) - 9 : margin.top + 17) + (marker.labelDy ?? 0)}
            fill={marker.color}
            fontSize="15"
            fontWeight="700"
          >
            {marker.label}
          </text>
        </g>
      ))}
      <text x={width / 2} y={height - 4} textAnchor="middle" fill="#475569" fontSize="15" fontWeight="700">
        {xLabel}
      </text>
      <text x="18" y={height / 2} textAnchor="middle" fill="#475569" fontSize="15" fontWeight="700" transform={`rotate(-90 18 ${height / 2})`}>
        {yLabel}
      </text>
    </svg>
  )
}

function BarSvg({
  bars,
  maxValue,
  limitValue,
  valueFormatter,
}: {
  bars: BarItem[]
  maxValue?: number
  limitValue?: number
  valueFormatter: (value: number) => string
}) {
  if (bars.length === 0) return null

  const width = 760
  const rowHeight = 42
  const height = Math.max(96, bars.length * rowHeight + 34)
  const margin = { left: 150, right: 40, top: 16, bottom: 16 }
  const plotWidth = width - margin.left - margin.right
  const max = maxValue ?? Math.max(...bars.map((bar) => bar.value), limitValue ?? 0) * 1.12
  const limitX = limitValue === undefined ? null : margin.left + (limitValue / (max || 1)) * plotWidth

  return (
    <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img">
      <rect width={width} height={height} rx="18" fill="#ffffff" />
      {limitX !== null ? (
        <g>
          <line x1={limitX} y1="8" x2={limitX} y2={height - 8} stroke="#dc2626" strokeWidth="2" strokeDasharray="7 7" />
        </g>
      ) : null}
      {bars.map((bar, index) => {
        const y = margin.top + index * rowHeight
        const barWidth = Math.max(2, (bar.value / (max || 1)) * plotWidth)
        return (
          <g key={`${bar.label}-${index}`}>
            <text x={margin.left - 14} y={y + 24} textAnchor="end" fill="#334155" fontSize="16" fontWeight="700">
              {bar.label}
            </text>
            <rect x={margin.left} y={y + 6} width={plotWidth} height="22" rx="11" fill="#eaf0f6" />
            <rect x={margin.left} y={y + 6} width={barWidth} height="22" rx="11" fill={bar.color} />
            <text x={Math.min(margin.left + barWidth + 10, width - 110)} y={y + 24} fill="#0f172a" fontSize="16" fontWeight="800">
              {valueFormatter(bar.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function MetricCard({ label, value, sub, tone = 'blue' }: { label: string; value: string; sub?: string; tone?: 'blue' | 'green' | 'orange' | 'rose' }) {
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50',
    green: 'border-emerald-200 bg-emerald-50',
    orange: 'border-orange-200 bg-orange-50',
    rose: 'border-rose-200 bg-rose-50',
  }

  return (
    <div className={`min-w-0 rounded-lg border p-4 ${toneClasses[tone]}`}>
      <div className="text-xs font-semibold uppercase text-slate-600">{label}</div>
      <div className="mt-2 break-words text-2xl font-bold leading-tight text-slate-950">{value}</div>
      {sub ? <div className="mt-1 text-sm leading-5 text-slate-600">{sub}</div> : null}
    </div>
  )
}

function sectionTitle(icon: ReactNode, title: string) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-blue-600">{icon}</span>
      <h4 className="text-base font-semibold text-slate-950">{title}</h4>
    </div>
  )
}

function spectrumSeries(responseSpectrum: Record<string, unknown> | null): LineSeries[] {
  const points = asArray(responseSpectrum?.designSpectrum)
    .map((item) => asRecord(item))
    .map((item) => ({
      x: finiteNumber(item?.period),
      y: finiteNumber(item?.alpha),
    }))
    .filter((point): point is ChartPoint => point.x !== null && point.y !== null)
  return points.length > 0 ? [{ name: 'alpha(T)', color: SERIES_COLORS[0], points }] : []
}

function methodLabel(value: unknown, locale: AppLocale) {
  const method = String(value ?? '').replace(/_/g, ' ').trim().toLowerCase()
  if (!method) return ''
  const labels: Record<string, { en: string; zh: string }> = {
    'response spectrum': { en: 'Response spectrum', zh: '反应谱' },
    'time history': { en: 'Time history', zh: '时程分析' },
    'modal time history': { en: 'Modal time history', zh: '模态时程' },
  }
  return labels[method]?.[locale] ?? method
}

function spectrumMarkers(responseSpectrum: Record<string, unknown> | null, designBasis: Record<string, unknown> | null) {
  const markers: ChartMarker[] = []
  const tg = finiteNumber(designBasis?.characteristicPeriod)
  if (tg !== null) {
    markers.push({ x: tg, label: `Tg=${tg.toFixed(2)}s`, color: '#dc2626', labelDy: 30 })
  }
  const firstMode = asArray(responseSpectrum?.spectrumAtModes).map((item) => asRecord(item)).find(Boolean)
  const period = finiteNumber(firstMode?.period)
  const alpha = finiteNumber(firstMode?.alpha)
  const modeNumber = finiteNumber(firstMode?.modeNumber) ?? 1
  if (period !== null) {
    markers.push({
      x: period,
      y: alpha ?? undefined,
      label: `T${modeNumber}=${period.toFixed(3)}s`,
      color: '#0f766e',
    })
  }
  return markers
}

function groundMotionSeries(timeHistory: Record<string, unknown> | null, t: Translator): LineSeries[] {
  return asArray(timeHistory?.records)
    .map((item, index) => {
      const record = asRecord(item)
      const preview = asRecord(record?.preview)
      const points = asArray(preview?.points)
        .map((point) => asRecord(point))
        .map((point) => ({
          x: finiteNumber(point?.time),
          y: finiteNumber(point?.accelG),
        }))
        .filter((point): point is ChartPoint => point.x !== null && point.y !== null)
      if (points.length === 0) return null
      return {
        name: stringValue(record?.name).replace(/\.csv$/i, '') || `${t('seismicVisualReportGroundMotionFallback')}${index + 1}`,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        points,
      }
    })
    .filter((item): item is LineSeries => Boolean(item))
}

function baseShearBars(timeHistory: Record<string, unknown> | null, t: Translator): BarItem[] {
  const baseShearCheck = asRecord(timeHistory?.baseShearCheck)
  const responseSpectrumBaseShear = finiteNumber(baseShearCheck?.responseSpectrumBaseShear)
  const bars: BarItem[] = []
  if (responseSpectrumBaseShear !== null) {
    bars.push({ label: t('seismicVisualReportResponseSpectrumShort'), value: responseSpectrumBaseShear, color: SERIES_COLORS[0] })
  }
  asArray(timeHistory?.records).forEach((item, index) => {
    const record = asRecord(item)
    const baseShear = finiteNumber(record?.baseShear)
    if (baseShear === null) return
    bars.push({
      label: stringValue(record?.name).replace(/\.csv$/i, '') || `${t('seismicVisualReportGroundMotionFallback')}${index + 1}`,
      value: baseShear,
      color: SERIES_COLORS[(index + 1) % SERIES_COLORS.length],
    })
  })
  const envelope = finiteNumber(timeHistory?.envelopeBaseShear)
  if (envelope !== null) {
    bars.push({ label: t('seismicVisualReportTimeHistoryEnvelopeShort'), value: envelope, color: '#dc2626' })
  }
  return bars
}

function spectrumMatchBars(timeHistory: Record<string, unknown> | null): BarItem[] {
  const spectrumMatch = asRecord(timeHistory?.spectrumMatch)
  return asArray(spectrumMatch?.periodChecks)
    .map((item, index) => {
      const row = asRecord(item)
      const period = finiteNumber(row?.period)
      const ratio = finiteNumber(row?.averageRatioToTarget)
      if (period === null || ratio === null) return null
      return {
        label: `${period.toFixed(3)}s`,
        value: ratio,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      }
    })
    .filter((item): item is BarItem => Boolean(item))
}

function codeRows(result: SeismicVisualReportProps['result'], t: Translator, locale: AppLocale) {
  const data = dataRecord(result)
  const methodDecision = asRecord(data?.methodDecision)
  const responseSpectrum = asRecord(data?.responseSpectrum)
  const responseFinal = asRecord(data?.responseSpectrumFinalCompliance) ?? asRecord(responseSpectrum?.finalCompliance)
  const elasticFinal = asRecord(data?.elasticStoryDriftFinalCompliance)
  const timeHistory = asRecord(data?.timeHistory)
  const groundMotionRequirement = asRecord(data?.groundMotionRequirement)
  const codeSummary = codeCheckSummaryRecord(result)
  const traceRows = clauseTraceability(result)

  const rows = [
    {
      item: t('seismicVisualReportMethodSelection'),
      value: asArray(methodDecision?.selectedMethods).map((item) => methodLabel(item, locale)).filter(Boolean).join(' + ') || methodLabel(methodDecision?.primaryMethod, locale),
      clause: 'GB/T 50011 5.1.2',
      status: 'pass',
    },
    {
      item: t('seismicVisualReportResponseSpectrumDrift'),
      value: `${driftText(responseFinal?.driftRatio)} <= ${driftText(responseFinal?.limitDriftRatio)}`,
      clause: stringValue(responseFinal?.clause) || 'GB/T 50011 5.5.1',
      status: stringValue(responseFinal?.status) || 'pass',
    },
    timeHistory
      ? {
      item: t('seismicVisualReportTimeHistoryDrift'),
      value: `${driftText(timeHistory?.maxStoryDriftRatio)} <= ${driftText(elasticFinal?.limitDriftRatio ?? responseFinal?.limitDriftRatio)}`,
      clause: stringValue(elasticFinal?.clause) || 'GB/T 50011 5.5.1',
      status: stringValue(elasticFinal?.status) || 'pass',
    }
      : null,
    groundMotionRequirement || timeHistory
      ? {
      item: t('seismicVisualReportGroundMotionCount'),
      value: `${numberText(groundMotionRequirement?.providedCount ?? asArray(timeHistory?.records).length, locale, 0)} / ${numberText(groundMotionRequirement?.requiredCount, locale, 0)}`,
      clause: 'GB/T 50011 5.1.2',
      status: stringValue(groundMotionRequirement?.status) || 'pass',
    }
      : null,
    timeHistory
      ? {
      item: t('seismicVisualReportSpectrumMatch'),
      value: numberText(asRecord(timeHistory?.spectrumMatch)?.averageModalSpectrumMinRatioToTarget, locale, 3),
      clause: 'GB/T 50011 5.1.2',
      status: asRecord(timeHistory?.spectrumMatch)?.modalSpectrumAverageOk === false ? 'fail' : 'pass',
    }
      : null,
    {
      item: t('seismicVisualReportMemberChecks'),
      value: codeSummary ? `${numberText(codeSummary.passed, locale, 0)} / ${numberText(codeSummary.total, locale, 0)}` : '',
      clause: stringValue(traceRows.find((row) => stringValue(row.item).includes('构件') || stringValue(row.check).includes('构件'))?.clause) || 'GB/T 50011',
      status: finiteNumber(codeSummary?.failed) === 0 ? 'pass' : 'fail',
    },
  ]

  return rows.filter((row): row is Exclude<typeof row, null> => Boolean(row)).filter((row) => row.value && row.value !== 'N/A')
}

export function SeismicVisualReport({ result, t, locale }: SeismicVisualReportProps) {
  const data = dataRecord(result)
  const responseSpectrum = asRecord(data?.responseSpectrum)
  const timeHistory = asRecord(data?.timeHistory)
  const designBasis = asRecord(data?.designBasis)
  const summary = asRecord(data?.summary)
  const methodDecision = asRecord(data?.methodDecision)
  const codeSummary = codeCheckSummaryRecord(result)
  const analysisType = stringValue(asRecord(result?.analysis?.meta)?.analysisType) || stringValue(result?.analysis?.analysis_type)
  const hasSeismicPayload = analysisType === 'seismic' || Boolean(responseSpectrum || timeHistory || designBasis?.intensity)

  if (!hasSeismicPayload) return null

  const spectrum = spectrumSeries(responseSpectrum)
  const motionSeries = groundMotionSeries(timeHistory, t)
  const shearBars = baseShearBars(timeHistory, t)
  const matchBars = spectrumMatchBars(timeHistory)
  const rows = codeRows(result, t, locale)
  const selectedMethods = asArray(methodDecision?.selectedMethods).map((item) => methodLabel(item, locale)).filter(Boolean).join(' + ')
  const rsDrift = asRecord(responseSpectrum?.finalCompliance)?.driftRatio ?? asRecord(data?.responseSpectrumFinalCompliance)?.driftRatio
  const thDrift = timeHistory?.maxStoryDriftRatio

  return (
    <Card data-testid="seismic-visual-report" className="overflow-hidden border-blue-200 bg-white text-slate-950 shadow-none dark:border-blue-200 dark:bg-white dark:text-slate-950">
      <CardHeader className="border-b border-slate-200 bg-slate-50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl tracking-normal text-slate-950">
              <Activity className="h-5 w-5 text-blue-600" />
              {t('seismicVisualReportTitle')}
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {t('seismicVisualReportDesc')}
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
            {t('seismicVisualReportLightMode')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label={t('analysisOverviewSeismicMethods')} value={selectedMethods || 'N/A'} sub={t('seismicVisualReportMethodDecisionSource')} />
          <MetricCard label={t('analysisOverviewGroundMotionRecords')} value={numberText(summary?.groundMotionRecordCount ?? asArray(timeHistory?.records).length, locale, 0)} sub={t('seismicVisualReportUploadedMotions')} tone="orange" />
          <MetricCard label={t('codeCheckSummaryTitle')} value={codeSummary ? `${numberText(codeSummary.passed, locale, 0)} / ${numberText(codeSummary.total, locale, 0)}` : 'N/A'} sub={t('seismicVisualReportCodeCheckSource')} tone="green" />
          <MetricCard label={t('analysisOverviewMaxBaseShear')} value={`${numberText(summary?.maxBaseShear ?? timeHistory?.envelopeBaseShear ?? responseSpectrum?.baseShear, locale, 2)} kN`} sub={stringValue(asRecord(data?.envelope)?.controlCase && asRecord(asRecord(data?.envelope)?.controlCase)?.baseShear) || t('seismicVisualReportEnvelopeSource')} tone="rose" />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {sectionTitle(<LineChart className="h-4 w-4" />, t('seismicVisualReportResponseSpectrumTitle'))}
            {spectrum.length > 0 ? (
              <LineSvg
                series={spectrum}
                markers={spectrumMarkers(responseSpectrum, designBasis)}
                xLabel={t('seismicVisualReportPeriodAxis')}
                yLabel={t('seismicVisualReportAlphaAxis')}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">{t('seismicVisualReportNoChartData')}</div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <MetricCard label={t('seismicVisualReportResponseSpectrumDrift')} value={driftText(rsDrift)} sub={`${t('seismicVisualReportLimit')} ${driftText(asRecord(responseSpectrum?.finalCompliance)?.limitDriftRatio)}`} tone="orange" />
              <MetricCard label={t('analysisOverviewModalCombination')} value={stringValue(responseSpectrum?.modalCombination).toUpperCase() || 'N/A'} sub={`${numberText(summary?.modalCount, locale, 0)} ${t('seismicVisualReportModes')}`} tone="blue" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {sectionTitle(<Waves className="h-4 w-4" />, t('seismicVisualReportTimeHistoryTitle'))}
            {motionSeries.length > 0 ? (
              <LineSvg
                series={motionSeries}
                xLabel={t('seismicVisualReportTimeAxis')}
                yLabel={t('seismicVisualReportAccelAxis')}
                symmetricY
              />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-500">
                {t('seismicVisualReportNoWaveformPreview')}
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <MetricCard label={t('seismicVisualReportTimeHistoryDrift')} value={driftText(thDrift)} sub={t('seismicVisualReportOpenSeesTransient')} tone="orange" />
              <MetricCard label={t('seismicVisualReportScaleFactor')} value={numberText(asRecord(timeHistory?.spectrumMatch)?.maxScaleFactor, locale, 3)} sub={t('analysisOverviewGroundMotionSpectrumCompatibility')} tone="green" />
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {sectionTitle(<BarChart3 className="h-4 w-4" />, t('seismicVisualReportBaseShearTitle'))}
            {shearBars.length > 0 ? (
              <BarSvg
                bars={shearBars}
                valueFormatter={(value) => `${numberText(value, locale, 2)} kN`}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">{t('seismicVisualReportNoChartData')}</div>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {sectionTitle(<CheckCircle2 className="h-4 w-4" />, t('seismicVisualReportSpectrumMatchTitle'))}
            {matchBars.length > 0 ? (
              <BarSvg
                bars={matchBars}
                maxValue={Math.max(1.1, ...matchBars.map((bar) => bar.value)) * 1.08}
                limitValue={0.65}
                valueFormatter={(value) => numberText(value, locale, 3)}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">{t('seismicVisualReportNoChartData')}</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {sectionTitle(<FileCheck2 className="h-4 w-4" />, t('seismicVisualReportCodeMatrixTitle'))}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-semibold">{t('seismicVisualReportCheckItem')}</th>
                  <th className="px-3 py-2 font-semibold">{t('seismicVisualReportEvidenceValue')}</th>
                  <th className="px-3 py-2 font-semibold">{t('codeCheckSummaryClauseLabel')}</th>
                  <th className="px-3 py-2 font-semibold">{t('seismicVisualReportStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.item}-${row.clause}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-3 font-medium text-slate-900">{row.item}</td>
                    <td className="px-3 py-3 font-semibold text-slate-950">{row.value}</td>
                    <td className="px-3 py-3 text-slate-700">{row.clause}</td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className={isPassingStatus(row.status) ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'}>
                        {isPassingStatus(row.status) ? t('codeCheckSummaryStatusPassed') : t('codeCheckSummaryStatusFailed')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
