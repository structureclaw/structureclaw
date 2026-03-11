'use client'

import { useStore } from '@/lib/stores/context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import type { AnalysisType, ReportFormat, ReportOutput } from '@/lib/stores/slices/console'
import { useI18n } from '@/lib/i18n'

/**
 * ConfigPanel - Configuration options and checkboxes for console execution
 *
 * CONS-05: User can configure analysis options (analysisType, reportFormat, reportOutput)
 * CONS-06: User can toggle checkboxes (includeModel, autoAnalyze, autoCodeCheck, includeReport)
 */
export function ConfigPanel() {
  const analysisType = useStore((state) => state.analysisType)
  const reportFormat = useStore((state) => state.reportFormat)
  const reportOutput = useStore((state) => state.reportOutput)
  const autoAnalyze = useStore((state) => state.autoAnalyze)
  const autoCodeCheck = useStore((state) => state.autoCodeCheck)
  const includeReport = useStore((state) => state.includeReport)

  const setAnalysisType = useStore((state) => state.setAnalysisType)
  const setReportFormat = useStore((state) => state.setReportFormat)
  const setReportOutput = useStore((state) => state.setReportOutput)
  const setAutoAnalyze = useStore((state) => state.setAutoAnalyze)
  const setAutoCodeCheck = useStore((state) => state.setAutoCodeCheck)
  const setIncludeReport = useStore((state) => state.setIncludeReport)
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      {/* Select Options - 3 Column Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Analysis Type Select */}
        <div className="space-y-2">
          <label htmlFor="analysis-type-select" className="text-sm font-medium">
            {t('analysisType')}
          </label>
          <Select
            value={analysisType}
            onValueChange={(value) => setAnalysisType(value as AnalysisType)}
          >
            <SelectTrigger id="analysis-type-select" aria-label="Analysis Type">
              <SelectValue placeholder="Select analysis type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="static">static</SelectItem>
              <SelectItem value="dynamic">dynamic</SelectItem>
              <SelectItem value="seismic">seismic</SelectItem>
              <SelectItem value="nonlinear">nonlinear</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Report Format Select */}
        <div className="space-y-2">
          <label htmlFor="report-format-select" className="text-sm font-medium">
            {t('reportFormat')}
          </label>
          <Select
            value={reportFormat}
            onValueChange={(value) => setReportFormat(value as ReportFormat)}
          >
            <SelectTrigger id="report-format-select" aria-label="Report Format">
              <SelectValue placeholder="Select report format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">json</SelectItem>
              <SelectItem value="markdown">markdown</SelectItem>
              <SelectItem value="both">both</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Report Output Select */}
        <div className="space-y-2">
          <label htmlFor="report-output-select" className="text-sm font-medium">
            {t('reportOutput')}
          </label>
          <Select
            value={reportOutput}
            onValueChange={(value) => setReportOutput(value as ReportOutput)}
          >
            <SelectTrigger id="report-output-select" aria-label="Report Output">
              <SelectValue placeholder="Select report output" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inline">inline</SelectItem>
              <SelectItem value="file">file</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Checkboxes Row */}
      <div className="flex flex-wrap gap-4">
        {/* Auto Analyze Checkbox */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="auto-analyze"
            aria-label={t('autoAnalyze')}
            checked={autoAnalyze}
            onCheckedChange={(checked) => setAutoAnalyze(checked === true)}
          />
          <label htmlFor="auto-analyze" className="text-sm font-medium cursor-pointer">
            {t('autoAnalyze')}
          </label>
        </div>

        {/* Auto Code Check Checkbox */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="auto-code-check"
            aria-label={t('autoCodeCheck')}
            checked={autoCodeCheck}
            onCheckedChange={(checked) => setAutoCodeCheck(checked === true)}
          />
          <label htmlFor="auto-code-check" className="text-sm font-medium cursor-pointer">
            {t('autoCodeCheck')}
          </label>
        </div>

        {/* Include Report Checkbox */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="include-report"
            aria-label={t('includeReport')}
            checked={includeReport}
            onCheckedChange={(checked) => setIncludeReport(checked === true)}
          />
          <label htmlFor="include-report" className="text-sm font-medium cursor-pointer">
            {t('includeReport')}
          </label>
        </div>
      </div>
    </div>
  )
}
