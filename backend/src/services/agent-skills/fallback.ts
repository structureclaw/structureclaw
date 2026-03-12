import type { AppLocale } from '../locale.js';
import type {
  AgentSkillBundle,
  DraftExtraction,
  DraftLoadPosition,
  DraftLoadType,
  DraftResult,
  DraftState,
  DraftSupportType,
  InferredModelType,
  InteractionQuestion,
  ScenarioMatch,
  ScenarioTemplateKey,
} from './types.js';

function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function extractNumber(text: string, patterns: RegExp[], groups: number[] = [1]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    for (const group of groups) {
      const value = match[group];
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function normalizeLoadType(value: unknown): DraftLoadType | undefined {
  return value === 'point' || value === 'distributed' ? value : undefined;
}

export function normalizeSupportType(value: unknown): DraftSupportType | undefined {
  return value === 'cantilever' || value === 'simply-supported' || value === 'fixed-fixed' || value === 'fixed-pinned'
    ? value
    : undefined;
}

export function normalizeLoadPosition(value: unknown): DraftLoadPosition | undefined {
  if (
    value === 'end'
    || value === 'midspan'
    || value === 'full-span'
    || value === 'top-nodes'
    || value === 'middle-joint'
    || value === 'free-joint'
  ) {
    return value;
  }
  return undefined;
}

export function normalizeInferredType(value: unknown): InferredModelType | undefined {
  if (value === 'beam' || value === 'truss' || value === 'portal-frame' || value === 'double-span-beam' || value === 'unknown') {
    return value;
  }
  return undefined;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function detectScenarioByRules(
  message: string,
  locale: AppLocale,
  bundles: AgentSkillBundle[],
  currentType?: InferredModelType,
): ScenarioMatch {
  const text = message.toLowerCase();
  const enabledTypes = new Set(bundles.map((bundle) => bundle.structureType));
  const supportedFallback = (key: ScenarioTemplateKey, mappedType: InferredModelType, noteZh: string, noteEn: string): ScenarioMatch => ({
    key,
    mappedType,
    supportLevel: 'fallback',
    supportNote: localize(locale, noteZh, noteEn),
  });

  if (text.includes('space frame') || text.includes('网架')) {
    return {
      key: 'space-frame',
      mappedType: 'unknown',
      supportLevel: 'unsupported',
      supportNote: localize(
        locale,
        '当前对话补参链路还不直接支持空间网架；如果你愿意，可先收敛成梁、桁架、门式刚架或双跨梁进行近似澄清。',
        'The current guidance flow does not directly support space frames yet. If acceptable, we can first simplify the problem to a beam, truss, portal frame, or double-span beam.'
      ),
    };
  }
  if (text.includes('slab') || text.includes('plate') || text.includes('楼板') || text.includes('板')) {
    return {
      key: 'plate-slab',
      mappedType: 'unknown',
      supportLevel: 'unsupported',
      supportNote: localize(
        locale,
        '当前补参链路还不直接支持板/楼板模型；请先确认是否可以简化为梁系、门式刚架或桁架问题。',
        'The current guidance flow does not directly support plate or slab models. Please confirm whether the problem can be simplified into beams, portal frames, or trusses.'
      ),
    };
  }
  if (text.includes('shell') || text.includes('壳')) {
    return {
      key: 'shell',
      mappedType: 'unknown',
      supportLevel: 'unsupported',
      supportNote: localize(
        locale,
        '当前补参链路还不直接支持壳体模型；请先说明是否可以收敛到梁、桁架或门式刚架的近似模型。',
        'The current guidance flow does not directly support shell models. Please clarify whether the problem can be reduced to a beam, truss, or portal-frame approximation.'
      ),
    };
  }
  if (text.includes('tower') || text.includes('塔')) {
    return {
      key: 'tower',
      mappedType: 'unknown',
      supportLevel: 'unsupported',
      supportNote: localize(
        locale,
        '当前补参链路还不直接支持塔架专用模板；如果只是杆系近似，可先按桁架继续澄清。',
        'The current guidance flow does not directly support tower-specific templates. If a truss approximation is acceptable, we can continue with that.'
      ),
    };
  }
  if (text.includes('bridge') || text.includes('桥')) {
    return {
      key: 'bridge',
      mappedType: 'unknown',
      supportLevel: 'unsupported',
      supportNote: localize(
        locale,
        '当前补参链路还不直接支持桥梁专用模板；若你只想先讨论单梁主梁近似，可收敛到梁模板。',
        'The current guidance flow does not directly support bridge-specific templates. If you only want a girder-style approximation first, we can narrow the problem to a beam template.'
      ),
    };
  }
  if ((text.includes('portal frame') || text.includes('门式刚架')) && enabledTypes.has('portal-frame')) {
    return { key: 'portal-frame', mappedType: 'portal-frame', supportLevel: 'supported' };
  }
  if ((text.includes('double-span') || text.includes('双跨梁')) && enabledTypes.has('double-span-beam')) {
    return { key: 'double-span-beam', mappedType: 'double-span-beam', supportLevel: 'supported' };
  }
  if ((text.includes('truss') || text.includes('桁架')) && enabledTypes.has('truss')) {
    return { key: 'truss', mappedType: 'truss', supportLevel: 'supported' };
  }
  if (text.includes('girder') || text.includes('主梁') || text.includes('大梁')) {
    return supportedFallback(
      'girder',
      enabledTypes.has('beam') ? 'beam' : 'unknown',
      '已将“主梁/大梁”先按梁模板处理；若实际是连续梁或更复杂体系，请继续说明。',
      '“Girder” has been normalized to the beam template for now. If the actual system is continuous or more complex, please clarify further.'
    );
  }
  if (text.includes('steel frame') || text.includes('钢框架')) {
    return supportedFallback(
      'steel-frame',
      enabledTypes.has('portal-frame') ? 'portal-frame' : 'unknown',
      '已将“钢框架”先收敛到门式刚架模板继续补参；如果是多层多跨框架，请继续说明，我会先做近似澄清。',
      '“Steel frame” has been narrowed to the portal-frame template for now. If the actual structure is multi-story or multi-bay, please say so and I will keep the guidance approximate.'
    );
  }
  if (text.includes('frame') || text.includes('框架')) {
    return supportedFallback(
      'frame',
      enabledTypes.has('portal-frame') ? 'portal-frame' : 'unknown',
      '已将“框架”先收敛到门式刚架模板继续补参；若不是单榀刚架，请继续补充结构特征。',
      '“Frame” has been narrowed to the portal-frame template for now. If it is not a single-bay rigid frame, please add more structural detail.'
    );
  }
  if (text.includes('portal') || text.includes('门架') || text.includes('刚架')) {
    return supportedFallback(
      'portal',
      enabledTypes.has('portal-frame') ? 'portal-frame' : 'unknown',
      '已将“门架/刚架”先收敛到门式刚架模板继续补参。',
      '“Portal structure” has been narrowed to the portal-frame template for continued guidance.'
    );
  }
  if ((text.includes('beam') || text.includes('梁') || text.includes('悬臂')) && enabledTypes.has('beam')) {
    return { key: 'beam', mappedType: 'beam', supportLevel: 'supported' };
  }
  if (currentType && currentType !== 'unknown' && enabledTypes.has(currentType)) {
    return { key: currentType, mappedType: currentType, supportLevel: 'supported' };
  }
  return {
    key: 'unknown',
    mappedType: 'unknown',
    supportLevel: 'unsupported',
    supportNote: localize(
      locale,
      '我还没有从当前描述中稳定识别出可直接补参的结构场景。请先说明它更接近梁、桁架、门式刚架还是双跨梁。',
      'I have not yet identified a stable structural scenario from the current description. Please tell me whether it is closer to a beam, truss, portal frame, or double-span beam.'
    ),
  };
}

export function extractDraftByRules(message: string): DraftExtraction {
  const text = message.toLowerCase();
  const inferredType = inferDraftType(text);
  const spanLengthM = extractNumber(text, [
    /每跨\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /双跨[^\d]*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /each span\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
    /per span\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ]);
  const lengthM = extractNumber(text, [
    /(跨度|跨长|长度|长)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /(span|length)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ], [2, 1]);
  const heightM = extractNumber(text, [
    /(柱高|高度|高)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /(height|column height)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ], [2]);
  const loadKN = extractNumber(text, [
    /(\d+(?:\.\d+)?)\s*(?:kn|千牛)\s*\/\s*(?:m|米)/i,
    /(\d+(?:\.\d+)?)\s*(?:kn|千牛)(?!\s*\/\s*m)/i,
    /(load)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*kn/i,
  ]);
  const supportType = extractSupportType(text);
  const loadType = extractLoadType(text);
  const loadPosition = extractLoadPosition(text, inferredType, loadType);

  return {
    inferredType,
    lengthM: lengthM ?? undefined,
    spanLengthM: spanLengthM ?? undefined,
    heightM: heightM ?? undefined,
    supportType,
    loadKN: loadKN ?? undefined,
    loadType,
    loadPosition,
  };
}

export function inferDraftType(text: string): InferredModelType {
  if (text.includes('门式刚架') || text.includes('portal frame')) {
    return 'portal-frame';
  }
  if (text.includes('双跨梁') || text.includes('double-span')) {
    return 'double-span-beam';
  }
  if (text.includes('桁架') || text.includes('truss')) {
    return 'truss';
  }
  if (text.includes('梁') || text.includes('beam') || text.includes('悬臂')) {
    return 'beam';
  }
  return 'unknown';
}

export function extractLoadType(text: string): DraftLoadType | undefined {
  if (text.includes('均布') || text.includes('distributed') || text.includes('uniform') || text.includes('udl')) {
    return 'distributed';
  }
  if (text.includes('点荷载') || text.includes('集中荷载') || text.includes('point load') || text.includes('concentrated')) {
    return 'point';
  }
  if (text.includes('端部') || text.includes('跨中') || text.includes('midspan') || text.includes('tip')) {
    return 'point';
  }
  return undefined;
}

export function extractSupportType(text: string): DraftSupportType | undefined {
  if (
    text.includes('fixed-pinned')
    || text.includes('fixed pinned')
    || text.includes('固铰')
    || text.includes('一端固结一端铰支')
  ) {
    return 'fixed-pinned';
  }
  if (
    text.includes('fixed-fixed')
    || text.includes('fixed fixed')
    || text.includes('两端固结')
    || text.includes('双固结')
  ) {
    return 'fixed-fixed';
  }
  if (
    text.includes('simply supported')
    || text.includes('simple support')
    || text.includes('简支')
  ) {
    return 'simply-supported';
  }
  if (text.includes('cantilever') || text.includes('悬臂')) {
    return 'cantilever';
  }
  return undefined;
}

export function extractLoadPosition(
  text: string,
  inferredType: InferredModelType,
  loadType: DraftLoadType | undefined,
): DraftLoadPosition | undefined {
  if (text.includes('柱顶') || text.includes('顶节点') || text.includes('top nodes')) {
    return 'top-nodes';
  }
  if (text.includes('中跨节点') || text.includes('中间节点') || text.includes('middle joint') || text.includes('center joint')) {
    return 'middle-joint';
  }
  if (text.includes('跨中') || text.includes('midspan') || text.includes('mid span')) {
    return 'midspan';
  }
  if (text.includes('全跨') || text.includes('整跨') || text.includes('满跨') || text.includes('full span') || text.includes('entire span')) {
    return 'full-span';
  }
  if (text.includes('端部') || text.includes('端点') || text.includes('tip') || text.includes('free end') || text.includes('at end')) {
    return 'end';
  }
  if (text.includes('节点') || text.includes('joint') || text.includes('node')) {
    return inferredType === 'double-span-beam' ? 'middle-joint' : 'free-joint';
  }
  if (loadType === 'distributed') {
    return inferredType === 'portal-frame' || inferredType === 'double-span-beam' || inferredType === 'beam'
      ? 'full-span'
      : undefined;
  }
  return undefined;
}

export function mergeDraftExtraction(preferred: DraftExtraction | null, fallback: DraftExtraction): DraftExtraction {
  return {
    inferredType: preferred?.inferredType && preferred.inferredType !== 'unknown' ? preferred.inferredType : fallback.inferredType,
    lengthM: preferred?.lengthM ?? fallback.lengthM,
    spanLengthM: preferred?.spanLengthM ?? fallback.spanLengthM,
    heightM: preferred?.heightM ?? fallback.heightM,
    supportType: preferred?.supportType ?? fallback.supportType,
    loadKN: preferred?.loadKN ?? fallback.loadKN,
    loadType: preferred?.loadType ?? fallback.loadType,
    loadPosition: preferred?.loadPosition ?? fallback.loadPosition,
  };
}

export function mergeDraftState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const mergedType = patch.inferredType && patch.inferredType !== 'unknown' ? patch.inferredType : (existing?.inferredType || 'unknown');
  const mergedLength = patch.lengthM ?? existing?.lengthM;
  const mergedSpan = patch.spanLengthM ?? existing?.spanLengthM;
  const spanLengthM = mergedSpan ?? ((mergedType === 'portal-frame' || mergedType === 'double-span-beam') ? mergedLength : undefined);

  return {
    inferredType: mergedType,
    lengthM: mergedLength,
    spanLengthM,
    heightM: patch.heightM ?? existing?.heightM,
    supportType: patch.supportType ?? existing?.supportType,
    loadKN: patch.loadKN ?? existing?.loadKN,
    loadType: patch.loadType ?? existing?.loadType,
    loadPosition: patch.loadPosition ?? existing?.loadPosition,
    updatedAt: Date.now(),
  };
}

export function computeMissingFields(state: DraftState): string[] {
  const missing: string[] = [];
  if (state.inferredType === 'unknown') {
    missing.push('结构类型（门式刚架/双跨梁/梁/平面桁架）');
    return missing;
  }
  if (state.inferredType === 'portal-frame') {
    if (state.spanLengthM === undefined) {
      missing.push('门式刚架跨度（m）');
    }
    if (state.heightM === undefined) {
      missing.push('门式刚架柱高（m）');
    }
    if (state.loadKN === undefined) {
      missing.push('荷载大小（kN）');
    }
    return missing;
  }
  if (state.inferredType === 'double-span-beam') {
    if (state.spanLengthM === undefined) {
      missing.push('每跨跨度（m）');
    }
    if (state.loadKN === undefined) {
      missing.push('荷载大小（kN）');
    }
    return missing;
  }
  if (state.lengthM === undefined) {
    missing.push('跨度/长度（m）');
  }
  if (state.inferredType === 'beam' && state.supportType === undefined) {
    missing.push('支座/边界条件（悬臂/简支/两端固结/固铰）');
  }
  if (state.loadKN === undefined) {
    missing.push('荷载大小（kN）');
  }
  return missing;
}

export function computeMissingCriticalKeys(state: DraftState): string[] {
  const missing: string[] = [];
  if (state.inferredType === 'unknown') {
    missing.push('inferredType');
    return missing;
  }
  if (state.inferredType === 'portal-frame') {
    if (state.spanLengthM === undefined) {
      missing.push('spanLengthM');
    }
    if (state.heightM === undefined) {
      missing.push('heightM');
    }
    if (state.loadKN === undefined) {
      missing.push('loadKN');
    }
    return missing;
  }
  if (state.inferredType === 'double-span-beam') {
    if (state.spanLengthM === undefined) {
      missing.push('spanLengthM');
    }
    if (state.loadKN === undefined) {
      missing.push('loadKN');
    }
    return missing;
  }
  if (state.lengthM === undefined) {
    missing.push('lengthM');
  }
  if (state.inferredType === 'beam' && state.supportType === undefined) {
    missing.push('supportType');
  }
  if (state.loadKN === undefined) {
    missing.push('loadKN');
  }
  return missing;
}

export function computeMissingLoadDetailKeys(state: DraftState): string[] {
  if (state.inferredType === 'unknown') {
    return [];
  }
  if (state.inferredType === 'beam' && state.supportType === undefined) {
    return [];
  }
  const missing: string[] = [];
  if (state.loadType === undefined) {
    missing.push('loadType');
  }
  if (state.loadPosition === undefined) {
    missing.push('loadPosition');
  }
  return missing;
}

export function mapMissingFieldLabels(missing: string[], locale: AppLocale): string[] {
  return missing.map((key) => {
    switch (key) {
      case 'inferredType':
        return localize(locale, '结构类型（门式刚架/双跨梁/梁/平面桁架）', 'Structure type (portal frame / double-span beam / beam / truss)');
      case 'lengthM':
        return localize(locale, '跨度/长度（m）', 'Span / length (m)');
      case 'spanLengthM':
        return localize(locale, '门式刚架或双跨每跨跨度（m）', 'Span length per bay for the portal frame or double-span beam (m)');
      case 'heightM':
        return localize(locale, '门式刚架柱高（m）', 'Portal-frame column height (m)');
      case 'supportType':
        return localize(locale, '支座/边界条件（悬臂/简支/两端固结/固铰）', 'Support condition (cantilever / simply supported / fixed-fixed / fixed-pinned)');
      case 'loadKN':
        return localize(locale, '荷载大小（kN）', 'Load magnitude (kN)');
      case 'loadType':
        return localize(locale, '荷载形式（点荷载/均布荷载）', 'Load type (point / distributed)');
      case 'loadPosition':
        return localize(locale, '荷载位置（按当前结构模板）', 'Load position (based on the current template)');
      default:
        return key;
    }
  });
}

export function buildSupportTypeQuestion(locale: AppLocale): string {
  return localize(
    locale,
    '请确认支座/边界条件（悬臂、简支、两端固结或固铰）。',
    'Please confirm the support condition (cantilever, simply supported, fixed-fixed, or fixed-pinned).'
  );
}

export function buildLoadTypeQuestion(type: InferredModelType, locale: AppLocale): string {
  switch (type) {
    case 'beam':
      return localize(locale, '请确认荷载形式（点荷载或均布荷载）。', 'Please confirm the load type (point or distributed).');
    case 'portal-frame':
      return localize(locale, '请确认门式刚架荷载形式（柱顶节点点荷载或檐梁均布荷载）。', 'Please confirm the portal-frame load type (top-node point load or distributed load on the rafter).');
    case 'double-span-beam':
      return localize(locale, '请确认双跨梁荷载形式（中间节点点荷载或两跨均布荷载）。', 'Please confirm the double-span load type (middle-joint point load or distributed load over both spans).');
    case 'truss':
      return localize(locale, '请确认桁架荷载形式（当前建议使用节点点荷载）。', 'Please confirm the truss load type (node point load is currently recommended).');
    default:
      return localize(locale, '请确认荷载形式（点荷载或均布荷载）。', 'Please confirm the load type (point or distributed).');
  }
}

export function buildLoadPositionQuestion(type: InferredModelType, locale: AppLocale): string {
  switch (type) {
    case 'beam':
      return localize(locale, '请确认荷载位置（端部/跨中/全跨）。', 'Please confirm the load position (end / midspan / full span).');
    case 'portal-frame':
      return localize(locale, '请确认荷载位置（柱顶节点/檐梁全跨）。', 'Please confirm the load position (top nodes / full rafter span).');
    case 'double-span-beam':
      return localize(locale, '请确认荷载位置（中间节点/两跨全跨）。', 'Please confirm the load position (middle joint / full span over both bays).');
    case 'truss':
      return localize(locale, '请确认荷载位置（受力节点）。', 'Please confirm the loaded joint.');
    default:
      return localize(locale, '请确认荷载位置。', 'Please confirm the load position.');
  }
}

export function buildInteractionQuestions(
  missingKeys: string[],
  criticalMissing: string[],
  draft: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return missingKeys.map((paramKey) => {
    const critical = criticalMissing.includes(paramKey);
    switch (paramKey) {
      case 'inferredType':
        return { paramKey, label: localize(locale, '结构类型', 'Structure type'), question: localize(locale, '请确认结构类型（门式刚架/双跨梁/梁/平面桁架）。', 'Please confirm the structure type (portal frame / double-span beam / beam / truss).'), required: true, critical };
      case 'lengthM':
        return { paramKey, label: localize(locale, '跨度/长度', 'Span / length'), question: localize(locale, '请确认跨度或长度。', 'Please confirm the span or length.'), unit: 'm', required: true, critical };
      case 'spanLengthM':
        return { paramKey, label: localize(locale, '每跨跨度', 'Span per bay'), question: localize(locale, '请确认门式刚架或双跨梁每跨跨度。', 'Please confirm the span length for each bay of the portal frame or double-span beam.'), unit: 'm', required: true, critical };
      case 'heightM':
        return { paramKey, label: localize(locale, '柱高', 'Column height'), question: localize(locale, '请确认门式刚架柱高。', 'Please confirm the portal-frame column height.'), unit: 'm', required: true, critical };
      case 'supportType':
        return { paramKey, label: localize(locale, '支座条件', 'Support condition'), question: buildSupportTypeQuestion(locale), required: true, critical, suggestedValue: 'simply-supported' };
      case 'loadKN':
        return { paramKey, label: localize(locale, '荷载', 'Load'), question: localize(locale, '请确认控制荷载大小。', 'Please confirm the controlling load magnitude.'), unit: 'kN', required: true, critical };
      case 'loadType':
        return { paramKey, label: localize(locale, '荷载形式', 'Load type'), question: buildLoadTypeQuestion(draft.inferredType, locale), required: true, critical, suggestedValue: 'point' };
      case 'loadPosition':
        return { paramKey, label: localize(locale, '荷载位置', 'Load position'), question: buildLoadPositionQuestion(draft.inferredType, locale), required: true, critical };
      default:
        return { paramKey, label: paramKey, question: localize(locale, `请确认参数 ${paramKey}。`, `Please confirm parameter ${paramKey}.`), required: true, critical };
    }
  });
}

export function getScenarioLabel(key: ScenarioTemplateKey, locale: AppLocale, bundles: AgentSkillBundle[]): string {
  const matched = bundles.find((bundle) => bundle.id === key || bundle.structureType === key);
  if (matched) {
    return locale === 'zh' ? matched.name.zh : matched.name.en;
  }
  switch (key) {
    case 'frame':
      return localize(locale, '框架', 'Frame');
    case 'steel-frame':
      return localize(locale, '钢框架', 'Steel Frame');
    case 'portal':
      return localize(locale, '门架/刚架', 'Portal Structure');
    case 'girder':
      return localize(locale, '主梁/大梁', 'Girder');
    case 'space-frame':
      return localize(locale, '空间网架', 'Space Frame');
    case 'plate-slab':
      return localize(locale, '板/楼板', 'Plate or Slab');
    case 'shell':
      return localize(locale, '壳体', 'Shell');
    case 'tower':
      return localize(locale, '塔架', 'Tower');
    case 'bridge':
      return localize(locale, '桥梁', 'Bridge');
    default:
      return localize(locale, '未识别', 'Unclassified');
  }
}

function buildBeamNodes(length: number, supportType: DraftSupportType) {
  const fixedRestraint = [true, false, true, false, true, false] as const;
  const pinnedRestraint = [true, false, true, false, false, false] as const;
  const rollerRestraint = [false, false, true, false, false, false] as const;
  let leftRestraint: boolean[] = [...fixedRestraint];
  let rightRestraint: boolean[] | undefined;

  if (supportType === 'simply-supported') {
    leftRestraint = [...pinnedRestraint];
    rightRestraint = [...rollerRestraint];
  } else if (supportType === 'fixed-fixed') {
    rightRestraint = [...fixedRestraint];
  } else if (supportType === 'fixed-pinned') {
    rightRestraint = [...pinnedRestraint];
  }

  return {
    nodes: [
      { id: '1', x: 0, y: 0, z: 0, restraints: leftRestraint },
      { id: '2', x: length / 2, y: 0, z: 0 },
      rightRestraint
        ? { id: '3', x: length, y: 0, z: 0, restraints: rightRestraint }
        : { id: '3', x: length, y: 0, z: 0 },
    ],
    elements: [
      { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
      { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
    ],
    middleNodeId: '2',
    endNodeId: '3',
  };
}

function buildBeamLoads(
  loadKN: number,
  loadType: DraftLoadType | undefined,
  loadPosition: DraftLoadPosition | undefined,
  middleNodeId: string,
  endNodeId: string,
) {
  if (loadType === 'distributed' || loadPosition === 'full-span') {
    return [
      { type: 'distributed', element: '1', wz: -loadKN },
      { type: 'distributed', element: '2', wz: -loadKN },
    ];
  }

  if (loadPosition === 'midspan') {
    return [{ node: middleNodeId, fy: -loadKN }];
  }

  return [{ node: endNodeId, fy: -loadKN }];
}

export function buildModel(state: DraftState): Record<string, unknown> {
  const metadata = {
    source: 'markdown-skill-draft',
    inferredType: state.inferredType,
  };
  if (state.inferredType === 'truss') {
    const length = state.lengthM!;
    const load = state.loadKN!;
    return {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: length, y: 0, z: 0, restraints: [false, true, true, true, true, true] },
      ],
      elements: [
        { id: '1', type: 'truss', nodes: ['1', '2'], material: '1', section: '1' },
      ],
      materials: [
        { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
      ],
      sections: [
        { id: '1', name: 'T1', type: 'rod', properties: { A: 0.01 } },
      ],
      load_cases: [
        { id: 'LC1', type: 'other', loads: [{ node: '2', fx: load }] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }
  if (state.inferredType === 'double-span-beam') {
    const span = state.spanLengthM!;
    const load = state.loadKN!;
    return {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: span, y: 0, z: 0 },
        { id: '3', x: span * 2, y: 0, z: 0, restraints: [false, true, true, true, true, true] },
      ],
      elements: [
        { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
        { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
      ],
      materials: [
        { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
      ],
      sections: [
        { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } },
      ],
      load_cases: [
        { id: 'LC1', type: 'other', loads: [{ node: '2', fy: -load }] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }
  if (state.inferredType === 'portal-frame') {
    const span = state.spanLengthM!;
    const height = state.heightM!;
    const load = state.loadKN!;
    return {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: span, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '3', x: 0, y: height, z: 0 },
        { id: '4', x: span, y: height, z: 0 },
      ],
      elements: [
        { id: '1', type: 'beam', nodes: ['1', '3'], material: '1', section: '1' },
        { id: '2', type: 'beam', nodes: ['3', '4'], material: '1', section: '1' },
        { id: '3', type: 'beam', nodes: ['4', '2'], material: '1', section: '1' },
      ],
      materials: [
        { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
      ],
      sections: [
        { id: '1', name: 'PF1', type: 'beam', properties: { A: 0.02, Iy: 0.0002 } },
      ],
      load_cases: [
        { id: 'LC1', type: 'other', loads: [{ node: '3', fy: -load / 2 }, { node: '4', fy: -load / 2 }] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }
  const length = state.lengthM!;
  const load = state.loadKN!;
  const supportType = state.supportType || 'cantilever';
  const beamNodes = buildBeamNodes(length, supportType);
  const beamLoads = buildBeamLoads(load, state.loadType, state.loadPosition, beamNodes.middleNodeId, beamNodes.endNodeId);
  return {
    schema_version: '1.0.0',
    unit_system: 'SI',
    nodes: beamNodes.nodes,
    elements: beamNodes.elements,
    materials: [
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
    ],
    sections: [
      { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } },
    ],
    load_cases: [
      { id: 'LC1', type: 'other', loads: beamLoads },
    ],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: { ...metadata, supportType },
  };
}

export function buildDraftResult(message: string, existingState: DraftState | undefined, llmExtraction: DraftExtraction | null): DraftResult {
  const ruleExtraction = extractDraftByRules(message);
  const extractionMode: 'llm' | 'rule-based' = llmExtraction ? 'llm' : 'rule-based';
  const mergedExtraction = mergeDraftExtraction(llmExtraction, ruleExtraction);
  const mergedState = mergeDraftState(existingState, mergedExtraction);
  const missingFields = computeMissingFields(mergedState);
  if (missingFields.length > 0) {
    return {
      inferredType: mergedState.inferredType,
      missingFields,
      extractionMode,
      stateToPersist: mergedState,
    };
  }
  return {
    inferredType: mergedState.inferredType,
    missingFields: [],
    extractionMode,
    model: buildModel(mergedState),
    stateToPersist: mergedState,
  };
}
