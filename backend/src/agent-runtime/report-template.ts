import type { AppLocale } from '../services/locale.js';
import type { SkillReportNarrativeInput } from './types.js';
import { localize } from './plugin-helpers.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function analysisData(input: SkillReportNarrativeInput): Record<string, unknown> {
  const analysis = asRecord(input.analysis);
  return asRecord(analysis['data']);
}

function yieldDriftSummary(parameters: Record<string, unknown>, locale: AppLocale): string {
  const ratio = parameters['yieldDriftLimitRatioText'] ?? parameters['yieldDriftRatio'];
  if (ratio === undefined || ratio === null || String(ratio).trim().length === 0) {
    return '';
  }
  const family = parameters['yieldDriftLimitFamily'];
  const familySuffix = family !== undefined && family !== null && String(family).trim().length > 0
    ? ` / ${String(family)}`
    : '';
  const fallbackSuffix = parameters['yieldDriftIsFallback'] === true
    ? localize(locale, '，回退', ', fallback')
    : '';
  return `${String(ratio)}${familySuffix}${fallbackSuffix}`;
}

function gb18306StatusLine(codeBasis: unknown[], locale: AppLocale): string {
  const record = codeBasis
    .map(asRecord)
    .find((entry) => String(entry['code'] ?? '').trim() === 'GB 18306-2015');
  if (!record) {
    return '';
  }
  const status = String(record['standardStatus'] ?? '').trim();
  const reviewConclusion = String(record['lastReviewConclusion'] ?? '').trim();
  const reviewDate = String(record['lastReviewDate'] ?? '').trim();
  const revisionPlan = asRecord(record['revisionPlan']);
  const revisionPlanNo = String(revisionPlan['planNo'] ?? '').trim();
  const revisionStatus = String(revisionPlan['status'] ?? '').trim();
  const latestAmendment = (Array.isArray(record['amendments'])
    ? record['amendments'].map(asRecord).find((item) => String(item['status'] ?? '').trim() === 'effective')
    : undefined) ?? {};
  const amendmentNo = String(latestAmendment['no'] ?? '').trim();
  const amendmentEffectiveDate = String(latestAmendment['effectiveDate'] ?? '').trim();
  const revisionStatusText = revisionStatus === 'drafting'
    ? localize(locale, '正在起草', 'drafting')
    : (revisionStatus || 'N/A');
  const statusText = status === 'current'
    ? localize(locale, '现行', 'current')
    : (status || 'N/A');
  const reviewText = reviewConclusion === 'continue_valid'
    ? localize(locale, '继续有效', 'continue valid')
    : (reviewConclusion || 'N/A');
  const reviewSuffix = reviewDate
    ? localize(locale, `，复审 ${reviewDate}: ${reviewText}`, `, review ${reviewDate}: ${reviewText}`)
    : '';
  const amendmentSuffix = amendmentNo
    ? localize(locale, `；${amendmentNo}修改单 ${amendmentEffectiveDate || 'N/A'} 起实施`, `; ${amendmentNo} amendment effective ${amendmentEffectiveDate || 'N/A'}`)
    : '';
  const revisionSuffix = revisionPlanNo
    ? localize(locale, `；修订计划 ${revisionPlanNo} ${revisionStatusText}，未作为当前正式设计依据`, `; revision plan ${revisionPlanNo} ${revisionStatusText}, not used as current formal design basis`)
    : '';
  return localize(
    locale,
    `- GB 18306 状态: ${statusText}${reviewSuffix}${amendmentSuffix}${revisionSuffix}`,
    `- GB 18306 status: ${statusText}${reviewSuffix}${amendmentSuffix}${revisionSuffix}`,
  );
}

function directionTimeHistorySummaries(directionResults: unknown): Array<{
  direction: string;
  recordCount: number;
  minBaseShearRatio: number | null;
  combinedBaseShear: unknown;
}> {
  if (!Array.isArray(directionResults)) {
    return [];
  }
  const items: Array<{
    direction: string;
    recordCount: number;
    minBaseShearRatio: number | null;
    combinedBaseShear: unknown;
  }> = [];
  directionResults.forEach((rawResult, index) => {
    const result = asRecord(rawResult);
    const timeHistory = asRecord(result['timeHistory']);
    if (Object.keys(timeHistory).length === 0) {
      return;
    }
    const records = Array.isArray(timeHistory['records']) ? timeHistory['records'] : [];
    const ratios = records
      .map((record) => Number(asRecord(record)['baseShearRatioToResponseSpectrum']))
      .filter((value) => Number.isFinite(value));
    const combinationSummary = asRecord(timeHistory['combinationSummary']);
    items.push({
      direction: String(result['direction'] ?? `D${index + 1}`),
      recordCount: records.length,
      minBaseShearRatio: ratios.length > 0 ? Math.min(...ratios) : null,
      combinedBaseShear: combinationSummary['combinedBaseShear'] ?? timeHistory['combinedBaseShear'] ?? 'N/A',
    });
  });
  return items;
}

function structuredReviewSummaries(data: Record<string, unknown>): Array<{
  reviewType: string;
  required: boolean;
  status: string;
  approvalId: string;
}> {
  return [
    ['overLimitReview', data['overLimitReview']],
    ['specialReview', data['specialReview']],
    ['specialSeismicReview', data['specialSeismicReview']],
    ['overLimitSpecialReview', data['overLimitSpecialReview']],
  ].map(([key, raw]) => {
    const record = asRecord(raw);
    if (Object.keys(record).length === 0) {
      return null;
    }
    const required = record['reviewRequired'] === true || record['required'] === true;
    const status = String(record['status'] ?? record['reviewStatus'] ?? record['approvalStatus'] ?? '').trim();
    const reviewType = String(record['reviewType'] ?? record['type'] ?? key).trim();
    const approvalId = String(record['approvalId'] ?? record['reviewId'] ?? record['reportId'] ?? '').trim();
    if (!required && !status && !approvalId) {
      return null;
    }
    return {
      reviewType,
      required,
      status,
      approvalId,
    };
  }).filter((item): item is {
    reviewType: string;
    required: boolean;
    status: string;
    approvalId: string;
  } => item !== null);
}

function seismicSourceTraceRows(
  data: Record<string, unknown>,
  designBasis: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const topLevelTrace = Array.isArray(data['sourceTrace'])
    ? data['sourceTrace']
    : [];
  const basisTrace = Array.isArray(designBasis['sourceTrace'])
    ? designBasis['sourceTrace']
    : [];
  const rawRows = topLevelTrace.length > 0 ? topLevelTrace : basisTrace;
  return rawRows.map(asRecord).filter((row) => {
    const field = String(row['field'] ?? '').trim();
    return field.length > 0;
  });
}

function traceDisplayValue(value: unknown): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : 'N/A';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(traceDisplayValue).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function codeCheckData(input: SkillReportNarrativeInput): Record<string, unknown> {
  const codeCheck = asRecord(input.codeCheck);
  const data = asRecord(codeCheck['data']);
  return Object.keys(data).length > 0 ? data : codeCheck;
}

function codeCheckDetails(input: SkillReportNarrativeInput): Array<Record<string, unknown>> {
  const data = codeCheckData(input);
  const details = data['details'];
  if (Array.isArray(details)) {
    return details.map(asRecord);
  }
  return [];
}

function codeCheckTopLevelChecks(input: SkillReportNarrativeInput): Array<Record<string, unknown>> {
  const data = codeCheckData(input);
  const checks = data['checks'];
  if (Array.isArray(checks)) {
    return checks.map(asRecord);
  }
  return [];
}

function flattenCodeCheckItems(input: SkillReportNarrativeInput): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const addItem = (
    item: Record<string, unknown>,
    detail: Record<string, unknown>,
    check: Record<string, unknown>,
  ) => {
    rows.push({
      elementId: detail['elementId'] ?? detail['id'] ?? '__global__',
      check: check['name'] ?? check['check'] ?? detail['check'] ?? 'unknown',
      item: item['item'] ?? item['name'] ?? check['item'] ?? '',
      clause: item['clause'] ?? check['clause'] ?? '',
      utilization: item['utilization'] ?? check['utilization'] ?? detail['utilization'],
      displayUtilization: item['displayUtilization'] ?? check['displayUtilization'] ?? detail['displayUtilization'],
      status: item['status'] ?? check['status'] ?? detail['status'] ?? 'unknown',
      category: item['category'] ?? check['category'] ?? detail['category'],
      failureType: item['failureType'] ?? check['failureType'] ?? detail['failureType'],
      message: item['message'] ?? item['reason'] ?? check['message'] ?? '',
    });
  };

  for (const detail of codeCheckDetails(input)) {
    const checks = Array.isArray(detail['checks']) ? detail['checks'].map(asRecord) : [];
    for (const check of checks) {
      const items = Array.isArray(check['items']) ? check['items'].map(asRecord) : [];
      if (items.length === 0 && (check['status'] || check['item'])) {
        addItem(check, detail, check);
      }
      for (const item of items) {
        addItem(item, detail, check);
      }
    }
    if (checks.length === 0 && (detail['status'] || detail['item'])) {
      addItem(detail, detail, {});
    }
  }

  for (const check of codeCheckTopLevelChecks(input)) {
    const items = Array.isArray(check['items']) ? check['items'].map(asRecord) : [];
    if (items.length === 0 && (check['status'] || check['item'])) {
      addItem(check, {}, check);
    }
    for (const item of items) {
      addItem(item, {}, check);
    }
  }

  return rows;
}

function codeCheckStatusRank(row: Record<string, unknown>): number {
  const status = String(row['status'] ?? '').trim().toLowerCase();
  if (status === 'fail' || status === 'failed') return 0;
  if (status === 'warning' || status === 'warn') return 1;
  if (status === 'not_applicable' || status === 'not-applicable' || status === 'n/a') return 2;
  if (status === 'unknown') return 3;
  return 4;
}

function codeCheckStatusLabel(statusValue: unknown, locale: AppLocale): string {
  const status = String(statusValue ?? '').trim().toLowerCase();
  if (status === 'pass' || status === 'passed') return localize(locale, '通过', 'pass');
  if (status === 'fail' || status === 'failed') return localize(locale, '未通过', 'fail');
  if (status === 'warning' || status === 'warn') return localize(locale, '警告', 'warning');
  if (status === 'not_applicable' || status === 'not-applicable' || status === 'n/a') return localize(locale, '资料不足/不适用', 'not applicable/unavailable');
  if (status === 'unknown') return localize(locale, '未知', 'unknown');
  return String(statusValue ?? 'N/A');
}

function codeCheckRowStatusLabel(row: Record<string, unknown>, locale: AppLocale): string {
  const status = String(row['status'] ?? '').trim().toLowerCase();
  const category = String(row['category'] ?? '').trim().toLowerCase();
  if (status === 'fail' || status === 'failed') {
    if (category === 'input_required') {
      return localize(locale, '需补充资料', 'needs input');
    }
    if (category === 'diagnostic' || category === 'trace') {
      return localize(locale, '诊断未通过', 'diagnostic fail');
    }
  }
  return codeCheckStatusLabel(row['status'], locale);
}

function codeCheckScopeLabel(value: unknown, locale: AppLocale): string {
  const scope = String(value ?? '').trim();
  if (scope === '__global_seismic__') {
    return localize(locale, '整体抗震流程', 'Global seismic workflow');
  }
  if (scope === '__global__') {
    return localize(locale, '全局校核', 'Global check');
  }
  return scope || 'N/A';
}

function codeCheckUtilizationDisplay(row: Record<string, unknown>): unknown {
  const displayValue = row['displayUtilization'];
  if (displayValue !== undefined && displayValue !== null && String(displayValue).trim().length > 0) {
    return displayValue;
  }
  const utilization = row['utilization'];
  const numeric = typeof utilization === 'number'
    ? utilization
    : typeof utilization === 'string' && utilization.trim().length > 0
      ? Number(utilization)
      : NaN;
  if (Number.isFinite(numeric) && Math.abs(numeric) >= 9999) {
    return 'N/A';
  }
  return utilization ?? 'N/A';
}

function markdownTableCell(value: unknown, maxLength = 160): string {
  const normalized = traceDisplayValue(value)
    .split('\r\n').join('<br>')
    .split('\n').join('<br>')
    .split('|').join('\\|');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function renderCodeCheckResultTable(rows: Array<Record<string, unknown>>, locale: AppLocale): string[] {
  if (rows.length === 0) {
    return [];
  }
  const maxRows = 200;
  const sortedRows = [...rows].sort((left, right) => codeCheckStatusRank(left) - codeCheckStatusRank(right));
  const visibleRows = sortedRows.slice(0, maxRows);
  const header = localize(
    locale,
    '| 状态 | 构件/范围 | 校核 | 验算项 | 条文 | 利用率 | 说明 |',
    '| Status | Element/Scope | Check | Item | Clause | Utilization | Note |',
  );
  return [
    '',
    localize(locale, '### 规范校核结果表', '### Code-Check Result Table'),
    header,
    '|---|---|---|---|---|---:|---|',
    ...visibleRows.map((row) => [
      markdownTableCell(codeCheckRowStatusLabel(row, locale), 32),
      markdownTableCell(codeCheckScopeLabel(row['elementId'], locale), 80),
      markdownTableCell(row['check'] ?? 'N/A', 100),
      markdownTableCell(row['item'] ?? 'N/A', 120),
      markdownTableCell(row['clause'] ?? 'N/A', 120),
      markdownTableCell(codeCheckUtilizationDisplay(row), 48),
      markdownTableCell(row['message'] ?? '', 180),
    ].join(' | ')).map((line) => `| ${line} |`),
    ...(rows.length > visibleRows.length
      ? [
        localize(
          locale,
          `- 校核表仅显示前 ${visibleRows.length} 项，共 ${rows.length} 项；请查看结构化 JSON 获取完整明细。`,
          `- The table shows the first ${visibleRows.length} of ${rows.length} items; inspect the structured JSON for full details.`,
        ),
      ]
      : []),
  ];
}

function renderCodeCheckSummaryMarkdown(input: SkillReportNarrativeInput): string[] {
  const data = codeCheckData(input);
  if (Object.keys(data).length === 0 || data['skipped'] === true) {
    return [];
  }
  const summary = asRecord(data['summary']);
  const hasSummary = Object.keys(summary).length > 0;
  const rows = flattenCodeCheckItems(input);
  if (!hasSummary && rows.length === 0) {
    return [];
  }

  const notableRows = rows
    .filter((row) => codeCheckStatusRank(row) < 4)
    .sort((left, right) => codeCheckStatusRank(left) - codeCheckStatusRank(right))
    .slice(0, 8);
  const rawNotApplicable = summary['notApplicable'] ?? summary['not_applicable'];
  const derivedNotApplicableCount = rows.filter((row) => codeCheckStatusRank(row) === 2).length;
  const notApplicableText = rawNotApplicable !== undefined && rawNotApplicable !== null
    ? String(rawNotApplicable)
    : derivedNotApplicableCount > 0
      ? String(derivedNotApplicableCount)
      : '';
  const notApplicableSummaryZh = notApplicableText ? `，不适用/资料不足 ${notApplicableText}` : '';
  const notApplicableSummaryEn = notApplicableText ? `, not applicable/unavailable ${notApplicableText}` : '';
  const controllingElement = summary['controllingElement'];
  const controllingCheck = summary['controllingCheck'];
  const maxUtilization = summary['maxUtilization'];
  const controllingUtilizationText = codeCheckUtilizationDisplay({ utilization: maxUtilization });

  return [
    '',
    localize(input.locale, '## 规范校核摘要', '## Code-Check Summary'),
    ...(hasSummary
      ? [
        localize(
          input.locale,
          `- 汇总: 总数 ${String(summary['total'] ?? 'N/A')}，通过 ${String(summary['passed'] ?? 'N/A')}，失败 ${String(summary['failed'] ?? 'N/A')}，警告 ${String(summary['warnings'] ?? 'N/A')}${notApplicableSummaryZh}`,
          `- Summary: total ${String(summary['total'] ?? 'N/A')}, passed ${String(summary['passed'] ?? 'N/A')}, failed ${String(summary['failed'] ?? 'N/A')}, warnings ${String(summary['warnings'] ?? 'N/A')}${notApplicableSummaryEn}`,
        ),
        ...(controllingElement || controllingCheck || maxUtilization !== undefined
          ? [
            localize(
              input.locale,
              `- 控制校核: ${codeCheckScopeLabel(controllingElement, input.locale)} / ${String(controllingCheck ?? 'N/A')} / 利用率 ${String(controllingUtilizationText)}`,
              `- Governing check: ${codeCheckScopeLabel(controllingElement, input.locale)} / ${String(controllingCheck ?? 'N/A')} / utilization ${String(controllingUtilizationText)}`,
            ),
          ]
          : []),
      ]
      : []),
    ...renderCodeCheckResultTable(rows, input.locale),
    ...(notableRows.length > 0
      ? [
        localize(input.locale, '- 失败或需关注项:', '- Failed or attention-required items:'),
        ...notableRows.map((row) => {
          const elementId = row['elementId'] ?? 'unknown';
          const check = row['check'] ?? 'unknown';
          const item = row['item'];
          const clause = row['clause'];
          const utilization = codeCheckUtilizationDisplay(row);
          const status = codeCheckRowStatusLabel(row, input.locale);
          const message = row['message'];
          const itemText = item !== undefined && item !== null && String(item).trim().length > 0
            ? ` / ${String(item)}`
            : '';
          const clauseText = clause !== undefined && clause !== null && String(clause).trim().length > 0
            ? ` / ${String(clause)}`
            : '';
          const messageText = message !== undefined && message !== null && String(message).trim().length > 0
            ? ` / ${String(message)}`
            : '';
          return localize(
            input.locale,
            `  - 范围 ${codeCheckScopeLabel(elementId, input.locale)} / ${String(check)}${itemText}${clauseText} / 利用率 ${String(utilization)} / ${String(status)}${messageText}`,
            `  - Scope ${codeCheckScopeLabel(elementId, input.locale)} / ${String(check)}${itemText}${clauseText} / utilization ${String(utilization)} / ${String(status)}${messageText}`,
          );
        }),
      ]
      : [
        localize(input.locale, '- 未发现失败或需关注的校核项。', '- No failed or attention-required check items found.'),
      ]),
  ];
}

function renderSeismicMarkdown(input: SkillReportNarrativeInput): string[] {
  if (input.analysisType !== 'seismic') {
    return [];
  }
  const data = analysisData(input);
  const summary = asRecord(data['summary']);
  const designBasis = asRecord(data['designBasis']);
  const groundMotionZonation = asRecord(designBasis['groundMotionZonation']);
  const fortificationCategoryLabel = asRecord(designBasis['fortificationCategoryLabel']);
  const methodDecision = asRecord(data['methodDecision']);
  const regularityAssessment = asRecord(data['regularityAssessment']);
  const responseSpectrum = asRecord(data['responseSpectrum']);
  const responseSpectrumEnvelope = asRecord(responseSpectrum['envelope']);
  const minimumStoryShearAdjustment = asRecord(responseSpectrum['minimumStoryShearAdjustment']);
  const longPeriodSpecialStudyAdvisory = asRecord(responseSpectrum['longPeriodSpecialStudyAdvisory']);
  const longPeriodGoverningMode = asRecord(longPeriodSpecialStudyAdvisory['governingMode']);
  const responseSpectrumFinalCompliance = asRecord(data['responseSpectrumFinalCompliance'] ?? responseSpectrum['finalCompliance']);
  const elasticStoryDriftFinalCompliance = asRecord(data['elasticStoryDriftFinalCompliance']);
  const periodRangeAssessment = asRecord(data['periodRangeAssessment'] ?? responseSpectrum['periodRangeAssessment']);
  const timeHistory = asRecord(data['timeHistory']);
  const timeHistoryControllingStory = asRecord(timeHistory['controllingStory']);
  const timeHistoryCombinationSummary = asRecord(timeHistory['combinationSummary']);
  const elasticPlasticTimeHistory = asRecord(data['elasticPlasticTimeHistory']);
  const elasticPlasticTimeHistoryFinalCompliance = asRecord(elasticPlasticTimeHistory['finalCompliance']);
  const elasticPlasticPerformanceObjective = asRecord(elasticPlasticTimeHistoryFinalCompliance['performanceObjective']);
  const elasticPlasticTimeHistoryParameters = asRecord(elasticPlasticTimeHistory['parameters']);
  const elasticPlasticYieldDriftSummary = yieldDriftSummary(elasticPlasticTimeHistoryParameters, input.locale);
  const nonlinearModelAudit = asRecord(elasticPlasticTimeHistory['nonlinearModelAudit']);
  const elasticPlasticRecords = Array.isArray(elasticPlasticTimeHistory['records'])
    ? elasticPlasticTimeHistory['records'].map(asRecord)
    : [];
  const elasticPlasticStoryResponses = elasticPlasticRecords.flatMap((record) => (
    Array.isArray(record['storyResponses'])
      ? record['storyResponses'].map(asRecord)
      : []
  ));
  const controllingElasticPlasticStory = elasticPlasticStoryResponses.reduce<Record<string, unknown>>((acc, item) => {
    const current = typeof item['maxDriftRatio'] === 'number' ? item['maxDriftRatio'] : -1;
    const previous = typeof acc['maxDriftRatio'] === 'number' ? acc['maxDriftRatio'] : -1;
    return current > previous ? item : acc;
  }, {});
  const controllingElasticPlasticHinge = asRecord(elasticPlasticTimeHistory['controllingHinge']);
  const seismicDesignActions = asRecord(data['seismicDesignActions']);
  const memberDesignActionCombinations = asRecord(data['memberDesignActionCombinations']);
  const verticalSeismic = asRecord(data['verticalSeismic']);
  const verticalOpenSeesStatic = asRecord(verticalSeismic['openSeesStatic']);
  const groundMotionRequirement = asRecord(data['groundMotionRequirement']);
  const catalogSelection = asRecord(timeHistory['catalogSelection']);
  const spectrumMatch = asRecord(timeHistory['spectrumMatch']);
  const pushover = asRecord(data['pushover']);
  const pushoverCapacity = asRecord(pushover['capacityAssessment']);
  const pushoverPerformancePoint = asRecord(pushoverCapacity['performancePoint']);
  const pushoverCapacityIteration = asRecord(pushoverCapacity['capacitySpectrumIteration']);
  const pushoverNonlinearEstimate = asRecord(pushover['nonlinearEstimate']);
  const pushoverNonlinearParameters = asRecord(pushoverNonlinearEstimate['parameters']);
  const pushoverYieldDriftSummary = yieldDriftSummary(pushoverNonlinearParameters, input.locale);
  const pushoverNonlinearPerformancePoint = asRecord(pushoverNonlinearEstimate['performancePoint']);
  const pushoverControllingStory = asRecord(pushoverNonlinearEstimate['controllingStory']);
  const pushoverControllingHinge = asRecord(pushoverNonlinearEstimate['controllingHinge']);
  const pushoverFinalCompliance = asRecord(pushover['finalCompliance']);
  const pushoverPerformanceObjective = asRecord(pushoverFinalCompliance['performanceObjective']);
  const codeBasis = Array.isArray(designBasis['codeBasis']) ? designBasis['codeBasis'] : [];
  const codes = codeBasis
    .map((item) => asRecord(item)['displayCode'] ?? asRecord(item)['code'])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const gb18306Status = gb18306StatusLine(codeBasis, input.locale);
  const workflowInputMode = typeof data['workflowInputMode'] === 'string' && data['workflowInputMode'].trim().length > 0
    ? data['workflowInputMode'].trim()
    : '';
  let workflowInputModeZh = workflowInputMode;
  let workflowInputModeEn = workflowInputMode;
  if (workflowInputMode === 'structured_seismic_workflow') {
    workflowInputModeZh = '结构化 seismicWorkflow';
    workflowInputModeEn = 'structured seismicWorkflow';
  } else if (workflowInputMode === 'legacy_compatibility_parameters') {
    workflowInputModeZh = '旧参数兼容路径';
    workflowInputModeEn = 'legacy compatibility parameters';
  }
  const legacyWorkflowInputMode = workflowInputMode === 'legacy_compatibility_parameters';
  const reasons = Array.isArray(methodDecision['reasons'])
    ? methodDecision['reasons'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const verticalSeismicReasons = Array.isArray(methodDecision['verticalSeismicReasons'])
    ? methodDecision['verticalSeismicReasons'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const specialSystemReasons = Array.isArray(methodDecision['specialSystemReasons'])
    ? methodDecision['specialSystemReasons'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const sourceTraceRows = seismicSourceTraceRows(data, designBasis).slice(0, 18);
  const specialSystemReview = asRecord(data['specialSystemReview']);
  const specialSystems = Array.isArray(specialSystemReview['systems'])
    ? specialSystemReview['systems'].map(String).filter((value) => value.trim().length > 0)
    : [];
  const specialSystemMissingInputs = Array.isArray(specialSystemReview['missingInputs'])
    ? specialSystemReview['missingInputs'].map(String).filter((value) => value.trim().length > 0)
    : [];
  const specialSystemDeviceCounts = asRecord(specialSystemReview['deviceCounts']);
  const specialSystemFailedCheckCount = specialSystemReview['failedCheckCount'];
  const specialSystemCheckCount = Array.isArray(specialSystemReview['checks'])
    ? specialSystemReview['checks'].length
    : 0;
  const isolationEquivalentLinearEstimate = asRecord(specialSystemReview['isolationEquivalentLinearEstimate']);
  const isolationEquivalentLinearFinalCompliance = asRecord(isolationEquivalentLinearEstimate['finalCompliance']);
  const isolationLayerTimeHistoryEstimate = asRecord(specialSystemReview['isolationLayerTimeHistoryEstimate']);
  const isolationLayerTimeHistoryFinalCompliance = asRecord(isolationLayerTimeHistoryEstimate['finalCompliance']);
  const energyDissipationEquivalentEstimate = asRecord(specialSystemReview['energyDissipationEquivalentEstimate']);
  const energyDissipationEquivalentFinalCompliance = asRecord(energyDissipationEquivalentEstimate['finalCompliance']);
  const energyDissipationTimeHistoryEstimate = asRecord(specialSystemReview['energyDissipationTimeHistoryEstimate']);
  const energyDissipationTimeHistoryFinalCompliance = asRecord(energyDissipationTimeHistoryEstimate['finalCompliance']);
  const missingInputs = Array.isArray(data['missingInputs'])
    ? data['missingInputs'].map(String).filter((value) => value.trim().length > 0)
    : Array.isArray(designBasis['missingInputs'])
      ? designBasis['missingInputs'].map(String).filter((value) => value.trim().length > 0)
      : [];
  const missingCapabilities = Array.isArray(data['missingCapabilities'])
    ? data['missingCapabilities'].map(String).filter((value) => value.trim().length > 0)
    : [];
  const isPreliminary = data['isPreliminary'] === true || designBasis['isPreliminary'] === true || missingInputs.length > 0;
  const selectedMethods = Array.isArray(methodDecision['selectedMethods'])
    ? methodDecision['selectedMethods'].map(String).join(', ')
    : String(methodDecision['primaryMethod'] ?? 'N/A');
  const directions = Array.isArray(summary['directions'])
    ? summary['directions'].map(String).filter((value) => value.trim().length > 0)
    : [];
  const timeHistoryDirectionSummaries = directionTimeHistorySummaries(data['directionResults']);
  const reviewSummaries = structuredReviewSummaries(data);
  const reviewSummaryZh = reviewSummaries.map((item) => [
    item.reviewType,
    item.required ? '需要' : '',
    item.status,
    item.approvalId,
  ].filter((value) => value.length > 0).join(' / '));
  const reviewSummaryEn = reviewSummaries.map((item) => [
    item.reviewType,
    item.required ? 'required' : '',
    item.status,
    item.approvalId,
  ].filter((value) => value.length > 0).join(' / '));
  const catalogIds = Array.isArray(catalogSelection['catalogIds'])
    ? catalogSelection['catalogIds'].map(String).filter((value) => value.trim().length > 0)
    : [];
  const requiredGroundMotionCount = String(groundMotionRequirement['requiredCount'] ?? 'N/A');
  const totalRequiredGroundMotionCount = groundMotionRequirement['totalRequiredCount'];
  const hasDirectionalGroundMotionRequirement = typeof totalRequiredGroundMotionCount === 'number'
    && totalRequiredGroundMotionCount !== groundMotionRequirement['requiredCount'];
  const minStoryShearWeightRatio = summary['minStoryShearWeightRatio']
    ?? responseSpectrum['minStoryShearWeightRatio']
    ?? responseSpectrumEnvelope['minStoryShearWeightRatio']
    ?? 'N/A';
  const groundMotionRequirementZh = hasDirectionalGroundMotionRequirement
    ? `每方向需 ${requiredGroundMotionCount} 条，总需 ${String(totalRequiredGroundMotionCount)} 条，已提供 ${String(groundMotionRequirement['providedCount'] ?? 'N/A')} 条，缺少 ${String(groundMotionRequirement['missingCount'] ?? 'N/A')} 条`
    : `需 ${requiredGroundMotionCount} 条，已提供 ${String(groundMotionRequirement['providedCount'] ?? 'N/A')} 条，缺少 ${String(groundMotionRequirement['missingCount'] ?? 'N/A')} 条`;
  const groundMotionRequirementEn = hasDirectionalGroundMotionRequirement
    ? `required ${requiredGroundMotionCount} per direction, total required ${String(totalRequiredGroundMotionCount)}, provided ${String(groundMotionRequirement['providedCount'] ?? 'N/A')}, missing ${String(groundMotionRequirement['missingCount'] ?? 'N/A')}`
    : `required ${requiredGroundMotionCount}, provided ${String(groundMotionRequirement['providedCount'] ?? 'N/A')}, missing ${String(groundMotionRequirement['missingCount'] ?? 'N/A')}`;
  const fortificationCategory = typeof designBasis['fortificationCategory'] === 'string'
    ? designBasis['fortificationCategory'].trim()
    : '';
  const fortificationCategoryZh = typeof fortificationCategoryLabel['zh'] === 'string' && fortificationCategoryLabel['zh'].trim().length > 0
    ? fortificationCategoryLabel['zh'].trim()
    : fortificationCategory;
  const fortificationCategoryEn = typeof fortificationCategoryLabel['en'] === 'string' && fortificationCategoryLabel['en'].trim().length > 0
    ? fortificationCategoryLabel['en'].trim()
    : fortificationCategory;
  const fortificationCodeClass = typeof designBasis['fortificationCategoryCodeClass'] === 'string'
    ? designBasis['fortificationCategoryCodeClass'].trim()
    : '';
  const seismicGradeSource = typeof designBasis['seismicGradeSource'] === 'string'
    ? designBasis['seismicGradeSource'].trim()
    : '';
  const seismicSafetyEvaluationRequired = designBasis['seismicSafetyEvaluationRequired'] === true;
  const seismicSafetyEvaluationProvided = designBasis['seismicSafetyEvaluationProvided'] === true;
  const seismicSafetyEvaluationZh = seismicSafetyEvaluationRequired
    ? (seismicSafetyEvaluationProvided ? '已提供' : '缺失')
    : '不需要';
  const seismicSafetyEvaluationEn = seismicSafetyEvaluationRequired
    ? (seismicSafetyEvaluationProvided ? 'provided' : 'missing')
    : 'not required';

  return [
    '',
    localize(input.locale, '## 抗震专项', '## Seismic Design'),
    localize(input.locale, `- 设计依据: ${codes.length > 0 ? codes.join('；') : 'N/A'}`, `- Design basis: ${codes.length > 0 ? codes.join('; ') : 'N/A'}`),
    ...(gb18306Status ? [gb18306Status] : []),
    ...(sourceTraceRows.length > 0
      ? [
        localize(input.locale, '- 抗震参数取值来源:', '- Seismic parameter sources:'),
        ...sourceTraceRows.map((row) => {
          const field = String(row['field'] ?? 'N/A');
          const value = traceDisplayValue(row['value']);
          const source = String(row['source'] ?? 'N/A');
          const sourceType = String(row['sourceType'] ?? 'N/A');
          const note = String(row['note'] ?? '').trim();
          const assumed = row['assumed'] === true;
          const noteZh = note ? ` / 说明 ${note}` : '';
          const noteEn = note ? ` / note ${note}` : '';
          const assumedZh = assumed ? ' / 假定' : '';
          const assumedEn = assumed ? ' / assumed' : '';
          return localize(
            input.locale,
            `  - ${field}: ${value} / 来源 ${source} / 类型 ${sourceType}${assumedZh}${noteZh}`,
            `  - ${field}: ${value} / source ${source} / type ${sourceType}${assumedEn}${noteEn}`,
          );
        }),
      ]
      : []),
    ...(workflowInputMode
      ? [
        localize(
          input.locale,
          `- 流程输入模式: ${workflowInputModeZh}`,
          `- Workflow input mode: ${workflowInputModeEn}`,
        ),
      ]
      : []),
    ...(legacyWorkflowInputMode
      ? [
        localize(
          input.locale,
          '- 计算书状态: 该结果来自旧参数兼容路径，不能作为正式中国抗震计算书；请基于结构化 seismicWorkflow 重新分析和校核。',
          '- Report status: this result came from the legacy compatibility parameter path and must not be used as a formal China seismic calculation report; rerun analysis and code-check from structured seismicWorkflow.',
        ),
      ]
      : []),
    localize(input.locale, `- 地区: ${String(designBasis['region'] ?? 'N/A')}`, `- Region: ${String(designBasis['region'] ?? 'N/A')}`),
    ...(Object.keys(groundMotionZonation).length > 0
      ? [
        localize(
          input.locale,
          `- 地震动参数区划: ${String(groundMotionZonation['source'] ?? 'N/A')}，地区码 ${String(groundMotionZonation['regionCode'] ?? 'N/A')}`,
          `- Ground-motion zonation: ${String(groundMotionZonation['source'] ?? 'N/A')}, region code ${String(groundMotionZonation['regionCode'] ?? 'N/A')}`,
        ),
      ]
      : []),
    localize(input.locale, `- 模型规模: 节点 ${String(summary['nodeCount'] ?? 'N/A')}，单元 ${String(summary['elementCount'] ?? 'N/A')}，楼层 ${String(summary['storyCount'] ?? designBasis['storyCount'] ?? 'N/A')}`, `- Model scale: nodes ${String(summary['nodeCount'] ?? 'N/A')}, elements ${String(summary['elementCount'] ?? 'N/A')}, stories ${String(summary['storyCount'] ?? designBasis['storyCount'] ?? 'N/A')}`),
    localize(input.locale, `- 设防烈度: ${String(designBasis['intensity'] ?? 'N/A')}`, `- Intensity: ${String(designBasis['intensity'] ?? 'N/A')}`),
    localize(input.locale, `- 设计基本地震加速度: ${String(designBasis['accelerationG'] ?? 'N/A')}`, `- Design basic acceleration: ${String(designBasis['accelerationG'] ?? 'N/A')}`),
    localize(input.locale, `- 地震水准: ${String(designBasis['earthquakeLevel'] ?? 'N/A')}`, `- Earthquake level: ${String(designBasis['earthquakeLevel'] ?? 'N/A')}`),
    ...(fortificationCategory
      ? [
        localize(
          input.locale,
          `- 设防类别: ${fortificationCategoryZh || 'N/A'}${fortificationCodeClass ? `（${fortificationCodeClass}类）` : ''}，抗震措施烈度 ${String(designBasis['seismicMeasureIntensity'] ?? 'N/A')}，安评 ${seismicSafetyEvaluationZh}`,
          `- Fortification category: ${fortificationCategoryEn || 'N/A'}${fortificationCodeClass ? ` (Class ${fortificationCodeClass})` : ''}, seismic measure intensity ${String(designBasis['seismicMeasureIntensity'] ?? 'N/A')}, safety evaluation ${seismicSafetyEvaluationEn}`,
        ),
      ]
      : []),
    localize(
      input.locale,
      `- 抗震等级: ${String(designBasis['seismicGrade'] ?? 'N/A')}${seismicGradeSource ? `（来源: ${seismicGradeSource}）` : ''}`,
      `- Seismic grade: ${String(designBasis['seismicGrade'] ?? 'N/A')}${seismicGradeSource ? ` (source: ${seismicGradeSource})` : ''}`,
    ),
    localize(input.locale, `- 设计地震分组: ${String(designBasis['designGroup'] ?? 'N/A')}`, `- Design earthquake group: ${String(designBasis['designGroup'] ?? 'N/A')}`),
    localize(input.locale, `- 场地类别: ${String(designBasis['siteCategory'] ?? 'N/A')}`, `- Site category: ${String(designBasis['siteCategory'] ?? 'N/A')}`),
    localize(input.locale, `- 特征周期 Tg: ${String(designBasis['characteristicPeriod'] ?? 'N/A')}`, `- Characteristic period Tg: ${String(designBasis['characteristicPeriod'] ?? 'N/A')}`),
    localize(input.locale, `- 水平地震影响系数最大值: ${String(designBasis['alphaMax'] ?? 'N/A')}`, `- Max horizontal seismic influence coefficient: ${String(designBasis['alphaMax'] ?? 'N/A')}`),
    ...(isPreliminary
      ? [
        localize(
          input.locale,
          `- 计算状态: 预分析，缺少或采用假定的关键抗震输入${missingInputs.length > 0 ? `（${missingInputs.join('；')}）` : ''}`,
          `- Calculation status: preliminary; missing or assumed key seismic inputs${missingInputs.length > 0 ? ` (${missingInputs.join('; ')})` : ''}`,
        ),
      ]
      : []),
    ...(missingCapabilities.length > 0
      ? [
        localize(
          input.locale,
          `- 能力边界: ${missingCapabilities.join('；')} 尚未实现，不能据此声明完整规范符合性`,
          `- Capability boundary: ${missingCapabilities.join('; ')} is not implemented, so full code compliance cannot be claimed from this run`,
        ),
      ]
      : []),
    ...(reviewSummaries.length > 0
      ? [
        localize(
          input.locale,
          `- 超限/专项审查: ${reviewSummaryZh.join('；')}`,
          `- Over-limit/special review: ${reviewSummaryEn.join('; ')}`,
        ),
      ]
      : []),
    ...(periodRangeAssessment['requiresSpecialStudy'] === true
      ? [
        localize(
          input.locale,
          `- 长周期专项研究: 最大模态周期 ${String(periodRangeAssessment['maxModePeriodSec'] ?? 'N/A')} s，超过常规设计谱上限 ${String(periodRangeAssessment['maxCodeSpectrumPeriodSec'] ?? '6.0')} s`,
          `- Long-period special study: max modal period ${String(periodRangeAssessment['maxModePeriodSec'] ?? 'N/A')} s exceeds the normal design-spectrum limit ${String(periodRangeAssessment['maxCodeSpectrumPeriodSec'] ?? '6.0')} s`,
        ),
        ...(Object.keys(longPeriodSpecialStudyAdvisory).length > 0
          ? [
            localize(
              input.locale,
              `- 长周期 advisory: 控制振型 ${String(longPeriodGoverningMode['modeNumber'] ?? 'N/A')}，周期 ${String(longPeriodGoverningMode['period'] ?? 'N/A')} s，建议谱系数 ${String(longPeriodGoverningMode['advisoryAlpha'] ?? 'N/A')}`,
              `- Long-period advisory: governing mode ${String(longPeriodGoverningMode['modeNumber'] ?? 'N/A')}, period ${String(longPeriodGoverningMode['period'] ?? 'N/A')} s, advisory alpha ${String(longPeriodGoverningMode['advisoryAlpha'] ?? 'N/A')}`,
            ),
          ]
          : []),
      ]
      : []),
    ...(methodDecision['specialSystemReviewRequired'] === true || specialSystemReasons.length > 0
      ? [
        localize(
          input.locale,
          `- 专门体系复核: ${specialSystemReasons.length > 0 ? specialSystemReasons.join('；') : '需要隔震或消能减震专项分析'}`,
          `- Special system review: ${specialSystemReasons.length > 0 ? specialSystemReasons.join('; ') : 'specialized isolation or energy-dissipation analysis is required'}`,
        ),
      ]
      : []),
    ...(specialSystemReview['reviewRequired'] === true
      ? [
        localize(
          input.locale,
          `- 专门体系审计: ${specialSystems.length > 0 ? specialSystems.join('、') : 'N/A'}；设备数 ${JSON.stringify(specialSystemDeviceCounts)}；缺失输入 ${specialSystemMissingInputs.length > 0 ? specialSystemMissingInputs.join('、') : '无'}；验收检查 ${specialSystemCheckCount} 项，失败 ${String(specialSystemFailedCheckCount ?? 0)} 项`,
          `- Special system audit: ${specialSystems.length > 0 ? specialSystems.join(', ') : 'N/A'}; device counts ${JSON.stringify(specialSystemDeviceCounts)}; missing inputs ${specialSystemMissingInputs.length > 0 ? specialSystemMissingInputs.join(', ') : 'none'}; acceptance checks ${specialSystemCheckCount}, failed ${String(specialSystemFailedCheckCount ?? 0)}`,
        ),
      ]
      : []),
    ...(isolationEquivalentLinearEstimate['status'] === 'estimated'
      ? [
        localize(
          input.locale,
          `- 隔震等效线性估算: 周期 ${String(isolationEquivalentLinearEstimate['periodSec'] ?? 'N/A')} s，位移需求 ${String(isolationEquivalentLinearEstimate['displacementDemandM'] ?? 'N/A')} m，容量 ${String(isolationEquivalentLinearEstimate['displacementCapacityM'] ?? 'N/A')} m，验收 ${String(isolationEquivalentLinearFinalCompliance['status'] ?? 'N/A')}`,
          `- Isolation equivalent-linear estimate: period ${String(isolationEquivalentLinearEstimate['periodSec'] ?? 'N/A')} s, displacement demand ${String(isolationEquivalentLinearEstimate['displacementDemandM'] ?? 'N/A')} m, capacity ${String(isolationEquivalentLinearEstimate['displacementCapacityM'] ?? 'N/A')} m, acceptance ${String(isolationEquivalentLinearFinalCompliance['status'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(isolationLayerTimeHistoryEstimate['status'] === 'estimated'
      ? [
        localize(
          input.locale,
          `- 隔震层 SDOF 时程估算: 周期 ${String(isolationLayerTimeHistoryEstimate['periodSec'] ?? 'N/A')} s，控制波 ${String(isolationLayerTimeHistoryEstimate['controllingRecord'] ?? 'N/A')}，位移需求 ${String(isolationLayerTimeHistoryEstimate['maxDisplacementM'] ?? 'N/A')} m，基底剪力 ${String(isolationLayerTimeHistoryEstimate['maxBaseShearKN'] ?? 'N/A')} kN，验收 ${String(isolationLayerTimeHistoryFinalCompliance['status'] ?? 'N/A')}`,
          `- Isolation-layer SDOF time-history estimate: period ${String(isolationLayerTimeHistoryEstimate['periodSec'] ?? 'N/A')} s, controlling record ${String(isolationLayerTimeHistoryEstimate['controllingRecord'] ?? 'N/A')}, displacement demand ${String(isolationLayerTimeHistoryEstimate['maxDisplacementM'] ?? 'N/A')} m, base shear ${String(isolationLayerTimeHistoryEstimate['maxBaseShearKN'] ?? 'N/A')} kN, acceptance ${String(isolationLayerTimeHistoryFinalCompliance['status'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(energyDissipationEquivalentEstimate['status'] === 'estimated'
      ? [
        localize(
          input.locale,
          `- 消能减震等效阻尼估算: 周期 ${String(energyDissipationEquivalentEstimate['periodSec'] ?? 'N/A')} s，等效阻尼比 ${String(energyDissipationEquivalentEstimate['equivalentDampingRatio'] ?? 'N/A')}，折减系数 ${String(energyDissipationEquivalentEstimate['demandReductionRatio'] ?? 'N/A')}，调整后变形需求 ${String(energyDissipationEquivalentEstimate['adjustedDisplacementDemandM'] ?? 'N/A')} m，容量 ${String(energyDissipationEquivalentEstimate['deformationCapacityM'] ?? 'N/A')} m，验收 ${String(energyDissipationEquivalentFinalCompliance['status'] ?? 'N/A')}`,
          `- Energy-dissipation equivalent-damping estimate: period ${String(energyDissipationEquivalentEstimate['periodSec'] ?? 'N/A')} s, equivalent damping ratio ${String(energyDissipationEquivalentEstimate['equivalentDampingRatio'] ?? 'N/A')}, reduction factor ${String(energyDissipationEquivalentEstimate['demandReductionRatio'] ?? 'N/A')}, adjusted deformation demand ${String(energyDissipationEquivalentEstimate['adjustedDisplacementDemandM'] ?? 'N/A')} m, capacity ${String(energyDissipationEquivalentEstimate['deformationCapacityM'] ?? 'N/A')} m, acceptance ${String(energyDissipationEquivalentFinalCompliance['status'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(energyDissipationTimeHistoryEstimate['status'] === 'estimated'
      ? [
        localize(
          input.locale,
          `- 消能器 SDOF 时程估算: 周期 ${String(energyDissipationTimeHistoryEstimate['periodSec'] ?? 'N/A')} s，控制波 ${String(energyDissipationTimeHistoryEstimate['controllingRecord'] ?? 'N/A')}，最大变形 ${String(energyDissipationTimeHistoryEstimate['maxDeviceDeformationM'] ?? 'N/A')} m，最大力 ${String(energyDissipationTimeHistoryEstimate['maxDeviceForceKN'] ?? 'N/A')} kN，验收 ${String(energyDissipationTimeHistoryFinalCompliance['status'] ?? 'N/A')}`,
          `- Energy-dissipation SDOF time-history estimate: period ${String(energyDissipationTimeHistoryEstimate['periodSec'] ?? 'N/A')} s, controlling record ${String(energyDissipationTimeHistoryEstimate['controllingRecord'] ?? 'N/A')}, max device deformation ${String(energyDissipationTimeHistoryEstimate['maxDeviceDeformationM'] ?? 'N/A')} m, max device force ${String(energyDissipationTimeHistoryEstimate['maxDeviceForceKN'] ?? 'N/A')} kN, acceptance ${String(energyDissipationTimeHistoryFinalCompliance['status'] ?? 'N/A')}`,
        ),
      ]
      : []),
    localize(input.locale, `- 规则性判别: ${String(regularityAssessment['classification'] ?? 'N/A')}`, `- Regularity assessment: ${String(regularityAssessment['classification'] ?? 'N/A')}`),
    localize(input.locale, `- 采用方法: ${selectedMethods}`, `- Selected methods: ${selectedMethods}`),
    ...(Object.keys(responseSpectrumFinalCompliance).length > 0
      ? [
        localize(
          input.locale,
          `- 反应谱弹性层间位移角: ${String(responseSpectrumFinalCompliance['status'] ?? 'N/A')}，位移角 ${String(responseSpectrumFinalCompliance['driftRatio'] ?? 'N/A')}，限值 ${String(responseSpectrumFinalCompliance['limitDriftRatio'] ?? 'N/A')}，利用率 ${String(responseSpectrumFinalCompliance['utilization'] ?? 'N/A')}`,
          `- Response-spectrum elastic drift: ${String(responseSpectrumFinalCompliance['status'] ?? 'N/A')}, drift ratio ${String(responseSpectrumFinalCompliance['driftRatio'] ?? 'N/A')}, limit ${String(responseSpectrumFinalCompliance['limitDriftRatio'] ?? 'N/A')}, utilization ${String(responseSpectrumFinalCompliance['utilization'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(Object.keys(elasticStoryDriftFinalCompliance).length > 0
      ? [
        localize(
          input.locale,
          `- 弹性总包络层间位移角: ${String(elasticStoryDriftFinalCompliance['status'] ?? 'N/A')}，位移角 ${String(elasticStoryDriftFinalCompliance['driftRatio'] ?? 'N/A')}，限值 ${String(elasticStoryDriftFinalCompliance['limitDriftRatio'] ?? 'N/A')}，利用率 ${String(elasticStoryDriftFinalCompliance['utilization'] ?? 'N/A')}`,
          `- Elastic envelope story drift: ${String(elasticStoryDriftFinalCompliance['status'] ?? 'N/A')}, drift ratio ${String(elasticStoryDriftFinalCompliance['driftRatio'] ?? 'N/A')}, limit ${String(elasticStoryDriftFinalCompliance['limitDriftRatio'] ?? 'N/A')}, utilization ${String(elasticStoryDriftFinalCompliance['utilization'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(Object.keys(elasticPlasticTimeHistory).length > 0
      ? [
        localize(
          input.locale,
          `- 弹塑性时程: ${String(elasticPlasticTimeHistory['status'] ?? 'N/A')}，最大漂移 ${String(elasticPlasticTimeHistory['maxDriftRatio'] ?? 'N/A')}，弹性对照${elasticPlasticTimeHistory['fallbackElasticTimeHistoryExecuted'] === true ? '已执行' : '未执行'}`,
          `- Elastic-plastic time history: ${String(elasticPlasticTimeHistory['status'] ?? 'N/A')}; max drift ${String(elasticPlasticTimeHistory['maxDriftRatio'] ?? 'N/A')}; elastic comparison ${elasticPlasticTimeHistory['fallbackElasticTimeHistoryExecuted'] === true ? 'executed' : 'not executed'}`,
        ),
        localize(
          input.locale,
          `- 弹塑性时程模型: ${String(elasticPlasticTimeHistory['modelScope'] ?? elasticPlasticTimeHistory['engineMode'] ?? 'N/A')}，楼层 ${String(elasticPlasticTimeHistoryParameters['storyCount'] ?? 'N/A')}`,
          `- Elastic-plastic time-history model: ${String(elasticPlasticTimeHistory['modelScope'] ?? elasticPlasticTimeHistory['engineMode'] ?? 'N/A')}, stories ${String(elasticPlasticTimeHistoryParameters['storyCount'] ?? 'N/A')}`,
        ),
        ...(elasticPlasticYieldDriftSummary
          ? [
            localize(
              input.locale,
              `- 弹塑性建议屈服位移角: ${elasticPlasticYieldDriftSummary}`,
              `- Elastic-plastic advisory yield drift: ${elasticPlasticYieldDriftSummary}`,
            ),
          ]
          : []),
        ...(Object.keys(nonlinearModelAudit).length > 0
          ? [
            localize(
              input.locale,
              `- 非线性模型输入审计: ${String(nonlinearModelAudit['status'] ?? 'N/A')}，材料模型 ${String(nonlinearModelAudit['materialModelCount'] ?? 'N/A')}，塑性铰 ${String(nonlinearModelAudit['memberPlasticHingeCount'] ?? 'N/A')}`,
              `- Nonlinear model input audit: ${String(nonlinearModelAudit['status'] ?? 'N/A')}, material models ${String(nonlinearModelAudit['materialModelCount'] ?? 'N/A')}, plastic hinges ${String(nonlinearModelAudit['memberPlasticHingeCount'] ?? 'N/A')}`,
            ),
          ]
          : []),
        ...(Object.keys(controllingElasticPlasticStory).length > 0
          ? [
            localize(
              input.locale,
              `- 弹塑性控制楼层: ${String(controllingElasticPlasticStory['story'] ?? 'N/A')}，层间位移角 ${String(controllingElasticPlasticStory['maxDriftRatio'] ?? 'N/A')}`,
              `- Elastic-plastic controlling story: ${String(controllingElasticPlasticStory['story'] ?? 'N/A')}, drift ratio ${String(controllingElasticPlasticStory['maxDriftRatio'] ?? 'N/A')}`,
            ),
          ]
          : []),
        ...(Object.keys(controllingElasticPlasticHinge).length > 0
          ? [
            localize(
              input.locale,
              `- 弹塑性控制塑性铰: ${String(controllingElasticPlasticHinge['elementId'] ?? controllingElasticPlasticHinge['id'] ?? 'N/A')} ${String(controllingElasticPlasticHinge['end'] ?? '')}，延性 ${String(controllingElasticPlasticHinge['ductility'] ?? 'N/A')}`,
              `- Elastic-plastic controlling plastic hinge: ${String(controllingElasticPlasticHinge['elementId'] ?? controllingElasticPlasticHinge['id'] ?? 'N/A')} ${String(controllingElasticPlasticHinge['end'] ?? '')}, ductility ${String(controllingElasticPlasticHinge['ductility'] ?? 'N/A')}`,
            ),
          ]
          : []),
        ...(Object.keys(elasticPlasticTimeHistoryFinalCompliance).length > 0
          ? [
            localize(
              input.locale,
              `- 弹塑性时程最终符合性: ${String(elasticPlasticTimeHistoryFinalCompliance['status'] ?? 'N/A')}，利用率 ${String(elasticPlasticTimeHistoryFinalCompliance['utilization'] ?? 'N/A')}`,
              `- Elastic-plastic time-history final compliance: ${String(elasticPlasticTimeHistoryFinalCompliance['status'] ?? 'N/A')}, utilization ${String(elasticPlasticTimeHistoryFinalCompliance['utilization'] ?? 'N/A')}`,
            ),
            ...(Object.keys(elasticPlasticPerformanceObjective).length > 0
              ? [
                localize(
                  input.locale,
                  `- 弹塑性性能目标: ${String(elasticPlasticPerformanceObjective['name'] ?? elasticPlasticPerformanceObjective['source'] ?? 'N/A')}，限值 ${String(elasticPlasticPerformanceObjective['acceptanceDriftRatio'] ?? 'N/A')}`,
                  `- Elastic-plastic performance objective: ${String(elasticPlasticPerformanceObjective['name'] ?? elasticPlasticPerformanceObjective['source'] ?? 'N/A')}, limit ${String(elasticPlasticPerformanceObjective['acceptanceDriftRatio'] ?? 'N/A')}`,
                ),
              ]
              : []),
          ]
          : []),
      ]
      : []),
    ...(Object.keys(seismicDesignActions).length > 0
      ? [
        localize(
          input.locale,
          `- 水平地震构件内力: ${String(seismicDesignActions['memberForceCount'] ?? 'N/A')} 个，方向 ${String(seismicDesignActions['direction'] ?? 'N/A')}`,
          `- Horizontal seismic member forces: ${String(seismicDesignActions['memberForceCount'] ?? 'N/A')}, direction ${String(seismicDesignActions['direction'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(Object.keys(memberDesignActionCombinations).length > 0
      ? [
        localize(
          input.locale,
          `- 抗震基本作用组合: ${String(memberDesignActionCombinations['caseCount'] ?? 'N/A')} 个工况，${String(memberDesignActionCombinations['memberCount'] ?? 'N/A')} 个构件`,
          `- Seismic basic action combinations: ${String(memberDesignActionCombinations['caseCount'] ?? 'N/A')} cases, ${String(memberDesignActionCombinations['memberCount'] ?? 'N/A')} members`,
        ),
      ]
      : []),
    ...(methodDecision['verticalSeismicRequired'] === true
      ? [
        localize(
          input.locale,
          `- 竖向地震作用: ${verticalSeismic['status'] === 'computed' ? `标准值 ${String(verticalSeismic['totalVerticalActionKN'] ?? 'N/A')} kN，系数 ${String(verticalSeismic['coefficient'] ?? 'N/A')}，构件内力 ${String(verticalOpenSeesStatic['memberForceCount'] ?? 'N/A')} 个` : '需要计算'}${verticalSeismicReasons.length > 0 ? `（${verticalSeismicReasons.join('；')}）` : ''}`,
          `- Vertical seismic action: ${verticalSeismic['status'] === 'computed' ? `standard value ${String(verticalSeismic['totalVerticalActionKN'] ?? 'N/A')} kN, coefficient ${String(verticalSeismic['coefficient'] ?? 'N/A')}, member forces ${String(verticalOpenSeesStatic['memberForceCount'] ?? 'N/A')}` : 'required'}${verticalSeismicReasons.length > 0 ? ` (${verticalSeismicReasons.join('; ')})` : ''}`,
        ),
      ]
      : []),
    ...(responseSpectrum['modalCombination']
      ? [
        localize(input.locale, `- 振型组合: ${String(responseSpectrum['modalCombination'])}`, `- Modal combination: ${String(responseSpectrum['modalCombination'])}`),
      ]
      : []),
    ...(directions.length > 0
      ? [
        localize(input.locale, `- 分析方向: ${directions.join(', ')}`, `- Analysis directions: ${directions.join(', ')}`),
      ]
      : []),
    ...(Object.keys(catalogSelection).length > 0
      ? [
        localize(input.locale, `- 地震波目录: ${String(catalogSelection['source'] ?? 'N/A')}`, `- Ground-motion catalog: ${String(catalogSelection['source'] ?? 'N/A')}`),
        localize(input.locale, `- 地震波编号: ${catalogIds.length > 0 ? catalogIds.join(', ') : 'N/A'}`, `- Ground-motion IDs: ${catalogIds.length > 0 ? catalogIds.join(', ') : 'N/A'}`),
      ]
      : []),
    localize(input.locale, `- 地震波数量: ${String(summary['groundMotionRecordCount'] ?? 'N/A')}`, `- Ground-motion count: ${String(summary['groundMotionRecordCount'] ?? 'N/A')}`),
    ...(groundMotionRequirement['required'] === true
      ? [
        localize(
          input.locale,
          `- 地震波需求: ${groundMotionRequirementZh}`,
          `- Ground-motion requirement: ${groundMotionRequirementEn}`,
        ),
      ]
      : []),
    ...(Object.keys(spectrumMatch).length > 0
      ? [
        localize(
          input.locale,
          `- 地震波调幅: 最大系数 ${String(spectrumMatch['maxScaleFactor'] ?? 'N/A')}，目标周期 ${String(spectrumMatch['targetPeriod'] ?? 'N/A')}`,
          `- Ground-motion scaling: max factor ${String(spectrumMatch['maxScaleFactor'] ?? 'N/A')}, target period ${String(spectrumMatch['targetPeriod'] ?? 'N/A')}`,
        ),
        localize(
          input.locale,
          `- 地震波谱适配: 最小平均谱比 ${String(spectrumMatch['averageModalSpectrumMinRatioToTarget'] ?? 'N/A')}，限值 ${String(spectrumMatch['modalSpectrumAverageMinRatio'] ?? 'N/A')}，状态 ${String(spectrumMatch['modalSpectrumAverageOk'] ?? 'N/A')}`,
          `- Ground-motion spectrum compatibility: min average spectrum ratio ${String(spectrumMatch['averageModalSpectrumMinRatioToTarget'] ?? 'N/A')}, limit ${String(spectrumMatch['modalSpectrumAverageMinRatio'] ?? 'N/A')}, status ${String(spectrumMatch['modalSpectrumAverageOk'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(Object.keys(timeHistoryCombinationSummary).length > 0
      ? [
        localize(
          input.locale,
          `- 时程组合: ${String(timeHistoryCombinationSummary['timeHistoryStatistic'] ?? 'N/A')} 与反应谱取大，控制来源 ${String(timeHistoryCombinationSummary['governingSource'] ?? 'N/A')}，组合基底剪力 ${String(timeHistoryCombinationSummary['combinedBaseShear'] ?? 'N/A')}`,
          `- Time-history combination: ${String(timeHistoryCombinationSummary['timeHistoryStatistic'] ?? 'N/A')} versus response spectrum, governing source ${String(timeHistoryCombinationSummary['governingSource'] ?? 'N/A')}, combined base shear ${String(timeHistoryCombinationSummary['combinedBaseShear'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(timeHistoryDirectionSummaries.length > 0
      ? [
        localize(
          input.locale,
          `- 方向时程摘要: ${timeHistoryDirectionSummaries.map((item) => `${item.direction} ${item.recordCount}条，最小基底剪力比 ${item.minBaseShearRatio === null ? 'N/A' : String(item.minBaseShearRatio)}，组合基底剪力 ${String(item.combinedBaseShear)}`).join('；')}`,
          `- Directional time-history summary: ${timeHistoryDirectionSummaries.map((item) => `${item.direction} ${item.recordCount} records, min base-shear ratio ${item.minBaseShearRatio === null ? 'N/A' : String(item.minBaseShearRatio)}, combined base shear ${String(item.combinedBaseShear)}`).join('; ')}`,
        ),
      ]
      : []),
    localize(input.locale, `- 最大基底剪力: ${String(input.keyMetrics.maxBaseShear ?? 'N/A')}`, `- Max base shear: ${String(input.keyMetrics.maxBaseShear ?? 'N/A')}`),
    localize(input.locale, `- 最大层间位移角: ${String(input.keyMetrics.maxStoryDriftRatio ?? 'N/A')}`, `- Max story drift ratio: ${String(input.keyMetrics.maxStoryDriftRatio ?? 'N/A')}`),
    ...(Object.keys(timeHistoryControllingStory).length > 0
      ? [
        localize(
          input.locale,
          `- 弹性时程控制楼层: ${String(timeHistoryControllingStory['story'] ?? 'N/A')}，层间位移角 ${String(timeHistoryControllingStory['driftRatio'] ?? 'N/A')}，地震波 ${String(timeHistoryControllingStory['record'] ?? 'N/A')}`,
          `- Elastic time-history controlling story: ${String(timeHistoryControllingStory['story'] ?? 'N/A')}, drift ratio ${String(timeHistoryControllingStory['driftRatio'] ?? 'N/A')}, record ${String(timeHistoryControllingStory['record'] ?? 'N/A')}`,
        ),
      ]
      : []),
    localize(input.locale, `- 模态质量参与系数: ${String(input.keyMetrics.modalMassParticipationRatio ?? 'N/A')}`, `- Modal mass participation ratio: ${String(input.keyMetrics.modalMassParticipationRatio ?? 'N/A')}`),
    localize(input.locale, `- 最小楼层剪重比: ${String(minStoryShearWeightRatio)}`, `- Minimum story shear-weight ratio: ${String(minStoryShearWeightRatio)}`),
    ...(Object.keys(minimumStoryShearAdjustment).length > 0
      ? [
        localize(
          input.locale,
          `- 楼层最小剪力调整: ${String(minimumStoryShearAdjustment['status'] ?? 'N/A')}，最大系数 ${String(minimumStoryShearAdjustment['maxAdjustmentFactor'] ?? 'N/A')}`,
          `- Minimum story shear adjustment: ${String(minimumStoryShearAdjustment['status'] ?? 'N/A')}, max factor ${String(minimumStoryShearAdjustment['maxAdjustmentFactor'] ?? 'N/A')}`,
        ),
      ]
      : []),
    ...(Object.keys(pushover).length > 0
      ? [
        localize(input.locale, `- Pushover 目标位移: ${String(pushover['targetDisplacement'] ?? 'N/A')}`, `- Pushover target displacement: ${String(pushover['targetDisplacement'] ?? 'N/A')}`),
        localize(input.locale, `- Pushover 最大屋顶位移: ${String(pushover['maxRoofDisplacement'] ?? 'N/A')}`, `- Pushover max roof displacement: ${String(pushover['maxRoofDisplacement'] ?? 'N/A')}`),
        ...(Object.keys(pushoverPerformancePoint).length > 0
          ? [
            localize(
              input.locale,
              `- Pushover 性能点: 位移 ${String(pushoverPerformancePoint['roofDisplacementM'] ?? 'N/A')} m，层间位移角 ${String(pushoverPerformancePoint['driftRatio'] ?? 'N/A')}`,
              `- Pushover performance point: displacement ${String(pushoverPerformancePoint['roofDisplacementM'] ?? 'N/A')} m, drift ratio ${String(pushoverPerformancePoint['driftRatio'] ?? 'N/A')}`,
            ),
            ...(Object.keys(pushoverCapacityIteration).length > 0
              ? [
                localize(
                  input.locale,
                  `- Pushover 容量谱迭代: ${String(pushoverCapacityIteration['status'] ?? 'N/A')}，迭代 ${String(pushoverCapacityIteration['iterationCount'] ?? 'N/A')}，周期 ${String(pushoverCapacityIteration['secantPeriodSec'] ?? 'N/A')} s`,
                  `- Pushover capacity-spectrum iteration: ${String(pushoverCapacityIteration['status'] ?? 'N/A')}, iterations ${String(pushoverCapacityIteration['iterationCount'] ?? 'N/A')}, period ${String(pushoverCapacityIteration['secantPeriodSec'] ?? 'N/A')} s`,
                ),
              ]
              : []),
          ]
          : []),
        ...(Object.keys(pushoverNonlinearPerformancePoint).length > 0
          ? [
            localize(
              input.locale,
              `- Pushover 弹塑性估算: 位移 ${String(pushoverNonlinearPerformancePoint['roofDisplacementM'] ?? 'N/A')} m，层间位移角 ${String(pushoverNonlinearPerformancePoint['driftRatio'] ?? 'N/A')}`,
              `- Pushover elastic-plastic estimate: displacement ${String(pushoverNonlinearPerformancePoint['roofDisplacementM'] ?? 'N/A')} m, drift ratio ${String(pushoverNonlinearPerformancePoint['driftRatio'] ?? 'N/A')}`,
            ),
            localize(
              input.locale,
              `- Pushover 弹塑性模型: ${String(pushoverNonlinearEstimate['modelScope'] ?? pushoverNonlinearEstimate['engineMode'] ?? 'N/A')}，楼层 ${String(pushoverNonlinearParameters['storyCount'] ?? 'N/A')}`,
              `- Pushover elastic-plastic model: ${String(pushoverNonlinearEstimate['modelScope'] ?? pushoverNonlinearEstimate['engineMode'] ?? 'N/A')}, stories ${String(pushoverNonlinearParameters['storyCount'] ?? 'N/A')}`,
            ),
            ...(pushoverYieldDriftSummary
              ? [
                localize(
                  input.locale,
                  `- Pushover 建议屈服位移角: ${pushoverYieldDriftSummary}`,
                  `- Pushover advisory yield drift: ${pushoverYieldDriftSummary}`,
                ),
              ]
              : []),
            ...(Object.keys(pushoverControllingStory).length > 0
              ? [
                localize(
                  input.locale,
                  `- Pushover 控制楼层: ${String(pushoverControllingStory['story'] ?? 'N/A')}，层间位移角 ${String(pushoverControllingStory['driftRatio'] ?? 'N/A')}`,
                  `- Pushover controlling story: ${String(pushoverControllingStory['story'] ?? 'N/A')}, drift ratio ${String(pushoverControllingStory['driftRatio'] ?? 'N/A')}`,
                ),
              ]
              : []),
            ...(Object.keys(pushoverControllingHinge).length > 0
              ? [
                localize(
                  input.locale,
                  `- Pushover 控制塑性铰: ${String(pushoverControllingHinge['elementId'] ?? pushoverControllingHinge['id'] ?? 'N/A')} ${String(pushoverControllingHinge['end'] ?? '')}，延性 ${String(pushoverControllingHinge['ductility'] ?? 'N/A')}`,
                  `- Pushover controlling plastic hinge: ${String(pushoverControllingHinge['elementId'] ?? pushoverControllingHinge['id'] ?? 'N/A')} ${String(pushoverControllingHinge['end'] ?? '')}, ductility ${String(pushoverControllingHinge['ductility'] ?? 'N/A')}`,
                ),
              ]
              : []),
          ]
          : []),
        ...(Object.keys(pushoverFinalCompliance).length > 0
          ? [
            localize(
              input.locale,
              `- Pushover 最终符合性: ${String(pushoverFinalCompliance['status'] ?? 'N/A')}，利用率 ${String(pushoverFinalCompliance['utilization'] ?? 'N/A')}`,
              `- Pushover final compliance: ${String(pushoverFinalCompliance['status'] ?? 'N/A')}, utilization ${String(pushoverFinalCompliance['utilization'] ?? 'N/A')}`,
            ),
            ...(Object.keys(pushoverPerformanceObjective).length > 0
              ? [
                localize(
                  input.locale,
                  `- Pushover 性能目标: ${String(pushoverPerformanceObjective['name'] ?? pushoverPerformanceObjective['source'] ?? 'N/A')}，限值 ${String(pushoverPerformanceObjective['acceptanceDriftRatio'] ?? 'N/A')}`,
                  `- Pushover performance objective: ${String(pushoverPerformanceObjective['name'] ?? pushoverPerformanceObjective['source'] ?? 'N/A')}, limit ${String(pushoverPerformanceObjective['acceptanceDriftRatio'] ?? 'N/A')}`,
                ),
              ]
              : []),
          ]
          : []),
      ]
      : []),
    ...(reasons.length > 0
      ? [
        localize(input.locale, '- 方法选择理由:', '- Method-selection reasons:'),
        ...reasons.slice(0, 4).map((reason) => `  - ${reason}`),
      ]
      : []),
  ];
}

function renderClauseTraceabilityMarkdown(
  traceability: Array<Record<string, unknown>>,
  locale: AppLocale,
): string[] {
  if (traceability.length === 0) {
    return [localize(locale, '- 无条文追溯数据', '- No clause traceability data')];
  }
  return traceability.slice(0, 8).map((row) => {
    const elementId = row['elementId'] ?? 'unknown';
    const check = row['check'] ?? 'unknown';
    const item = row['item'];
    const itemSuffix = item !== undefined && item !== null && String(item).trim().length > 0
      ? ` / ${String(item)}`
      : '';
    const clause = row['clause'] ?? '';
    const utilization = codeCheckUtilizationDisplay(row);
    const status = codeCheckRowStatusLabel(row, locale);
    return localize(
      locale,
      `- 范围 ${codeCheckScopeLabel(elementId, locale)} / ${String(check)}${itemSuffix} / ${String(clause)} / 利用率 ${String(utilization)} / ${String(status)}`,
      `- Scope ${codeCheckScopeLabel(elementId, locale)} / ${String(check)}${itemSuffix} / ${String(clause)} / utilization ${String(utilization)} / ${String(status)}`,
    );
  });
}

function renderControllingCasesMarkdown(
  controllingCases: Record<string, unknown>,
  locale: AppLocale,
): string[] {
  const batchControlCaseRaw = controllingCases['batchControlCase'];
  const batchControlCase = batchControlCaseRaw && typeof batchControlCaseRaw === 'object'
    ? batchControlCaseRaw as Record<string, unknown>
    : {};

  return [
    localize(locale, `- 批量位移控制工况: ${String(batchControlCase['displacement'] ?? 'N/A')}`, `- Governing displacement case: ${String(batchControlCase['displacement'] ?? 'N/A')}`),
    localize(locale, `- 批量轴力控制工况: ${String(batchControlCase['axialForce'] ?? 'N/A')}`, `- Governing axial-force case: ${String(batchControlCase['axialForce'] ?? 'N/A')}`),
    localize(locale, `- 批量剪力控制工况: ${String(batchControlCase['shearForce'] ?? 'N/A')}`, `- Governing shear-force case: ${String(batchControlCase['shearForce'] ?? 'N/A')}`),
    localize(locale, `- 批量弯矩控制工况: ${String(batchControlCase['moment'] ?? 'N/A')}`, `- Governing moment case: ${String(batchControlCase['moment'] ?? 'N/A')}`),
    localize(locale, `- 批量反力控制工况: ${String(batchControlCase['reaction'] ?? 'N/A')}`, `- Governing reaction case: ${String(batchControlCase['reaction'] ?? 'N/A')}`),
    localize(locale, `- 位移控制节点: ${String(controllingCases['controlNodeDisplacement'] ?? 'N/A')}`, `- Control displacement node: ${String(controllingCases['controlNodeDisplacement'] ?? 'N/A')}`),
    localize(locale, `- 轴力控制单元: ${String(controllingCases['controlElementAxialForce'] ?? 'N/A')}`, `- Control axial-force element: ${String(controllingCases['controlElementAxialForce'] ?? 'N/A')}`),
    localize(locale, `- 剪力控制单元: ${String(controllingCases['controlElementShearForce'] ?? 'N/A')}`, `- Control shear-force element: ${String(controllingCases['controlElementShearForce'] ?? 'N/A')}`),
    localize(locale, `- 弯矩控制单元: ${String(controllingCases['controlElementMoment'] ?? 'N/A')}`, `- Control moment element: ${String(controllingCases['controlElementMoment'] ?? 'N/A')}`),
    localize(locale, `- 反力控制节点: ${String(controllingCases['controlNodeReaction'] ?? 'N/A')}`, `- Control reaction node: ${String(controllingCases['controlNodeReaction'] ?? 'N/A')}`),
  ];
}

function renderControlNodeDisplacementMarkdown(input: SkillReportNarrativeInput): string[] {
  const data = analysisData(input);
  const displacements = asRecord(data['displacements']);
  const envelope = asRecord(data['envelope']);
  const summary = asRecord(data['summary']);
  const controlNodeId = String(
    input.controllingCases['controlNodeDisplacement']
      ?? envelope['controlNodeDisplacement']
      ?? summary['maxDisplacementNode']
      ?? '',
  ).trim();
  if (!controlNodeId) {
    return [];
  }

  const response = asRecord(displacements[controlNodeId]);
  const components = ['ux', 'uy', 'uz']
    .filter((key) => typeof response[key] === 'number' && Number.isFinite(response[key]))
    .map((key) => `${key}=${String(response[key])}`);
  if (components.length === 0) {
    return [];
  }

  const model = asRecord(input.normalizedModel);
  const nodes = Array.isArray(model['nodes']) ? model['nodes'].map(asRecord) : [];
  const controlNode = nodes.find((node) => String(node['id'] ?? '') === controlNodeId);
  const coordinates = controlNode
    ? ['x', 'y', 'z']
      .filter((key) => typeof controlNode[key] === 'number' && Number.isFinite(controlNode[key]))
      .map((key) => `${key}=${String(controlNode[key])}`)
    : [];
  const meta = asRecord(data['meta']);
  const units = asRecord(meta['units']);
  const unit = String(units['displacement'] ?? '').trim();
  const coordinateText = coordinates.length > 0
    ? localize(input.locale, `，全局坐标 (${coordinates.join(', ')})`, ` at global coordinates (${coordinates.join(', ')})`)
    : '';
  const unitText = unit ? ` ${unit}` : '';

  return [
    localize(
      input.locale,
      `- 控制节点位移响应: 节点 ${controlNodeId}${coordinateText}，${components.join(', ')}${unitText}`,
      `- Control-node displacement response: node ${controlNodeId}${coordinateText}, ${components.join(', ')}${unitText}`,
    ),
  ];
}

export function buildDefaultReportNarrative(input: SkillReportNarrativeInput): string {
  const { locale, message, analysisType, analysisSuccess, codeCheckText, summary, keyMetrics, clauseTraceability, controllingCases } = input;

  return [
    localize(locale, '# StructureClaw 计算报告', '# StructureClaw Calculation Report'),
    '',
    localize(locale, '## 目录', '## Contents'),
    localize(locale, '1. 执行摘要', '1. Executive Summary'),
    localize(locale, '2. 关键指标', '2. Key Metrics'),
    localize(locale, '3. 条文追溯', '3. Clause Traceability'),
    localize(locale, '4. 控制工况', '4. Governing Cases'),
    '',
    localize(locale, '## 执行摘要', '## Executive Summary'),
    localize(locale, `- 用户意图：${message}`, `- User intent: ${message}`),
    localize(locale, `- 分析类型：${analysisType}`, `- Analysis type: ${analysisType}`),
    localize(locale, `- 分析结果：${analysisSuccess ? '成功' : '失败'}`, `- Analysis result: ${analysisSuccess ? 'Success' : 'Failure'}`),
    localize(locale, `- 规范校核：${codeCheckText}`, `- Code checks: ${codeCheckText}`),
    '',
    summary,
    '',
    localize(locale, '## 关键指标', '## Key Metrics'),
    localize(locale, `- 最大位移: ${String(keyMetrics.maxAbsDisplacement ?? 'N/A')}`, `- Max displacement: ${String(keyMetrics.maxAbsDisplacement ?? 'N/A')}`),
    ...renderControlNodeDisplacementMarkdown(input),
    localize(locale, `- 最大轴力: ${String(keyMetrics.maxAbsAxialForce ?? 'N/A')}`, `- Max axial force: ${String(keyMetrics.maxAbsAxialForce ?? 'N/A')}`),
    localize(locale, `- 最大剪力: ${String(keyMetrics.maxAbsShearForce ?? 'N/A')}`, `- Max shear force: ${String(keyMetrics.maxAbsShearForce ?? 'N/A')}`),
    localize(locale, `- 最大弯矩: ${String(keyMetrics.maxAbsMoment ?? 'N/A')}`, `- Max moment: ${String(keyMetrics.maxAbsMoment ?? 'N/A')}`),
    localize(locale, `- 最大反力: ${String(keyMetrics.maxAbsReaction ?? 'N/A')}`, `- Max reaction: ${String(keyMetrics.maxAbsReaction ?? 'N/A')}`),
    localize(locale, `- 校核通过率: ${String(keyMetrics.codeCheckPassRate ?? 'N/A')}`, `- Code-check pass rate: ${String(keyMetrics.codeCheckPassRate ?? 'N/A')}`),
    ...renderCodeCheckSummaryMarkdown(input),
    ...renderSeismicMarkdown(input),
    '',
    localize(locale, '## 条文追溯', '## Clause Traceability'),
    ...renderClauseTraceabilityMarkdown(clauseTraceability, locale),
    '',
    localize(locale, '## 控制工况', '## Governing Cases'),
    ...renderControllingCasesMarkdown(controllingCases, locale),
  ].join('\n');
}
