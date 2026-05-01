import type { AppLocale } from '../services/locale.js';
import type {
  DraftExtraction,
  DraftFloorLoad,
  DraftLoadPosition,
  DraftLoadType,
  DraftState,
  DraftSupportType,
  FrameBaseSupportType,
  FrameDimension,
  InferredModelType,
  InteractionQuestion,
  StructuralTypeMatch,
  StructuralTypeKey,
} from './types.js';
import { buildModel as buildDraftModel } from './model-builder.js';
import { localize } from './plugin-helpers.js';

function repeatValue(count: number | undefined, value: number | undefined): number[] | undefined {
  if (!count || !value || count <= 0 || value <= 0) {
    return undefined;
  }
  return Array.from({ length: count }, () => value);
}

function buildUniformFloorLoads(
  storyCount: number | undefined,
  verticalKN: number | undefined,
  lateralXKN: number | undefined,
  lateralYKN: number | undefined,
): DraftFloorLoad[] | undefined {
  if (!storyCount || storyCount <= 0) {
    return undefined;
  }
  if (verticalKN === undefined && lateralXKN === undefined && lateralYKN === undefined) {
    return undefined;
  }
  return Array.from({ length: storyCount }, (_, index) => ({
    story: index + 1,
    verticalKN,
    lateralXKN,
    lateralYKN,
  }));
}

function mergeFloorLoads(
  existing: DraftFloorLoad[] | undefined,
  incoming: DraftFloorLoad[] | undefined,
): DraftFloorLoad[] | undefined {
  if (!existing?.length) {
    return incoming?.length ? [...incoming].sort((a, b) => a.story - b.story) : undefined;
  }
  if (!incoming?.length) {
    return [...existing].sort((a, b) => a.story - b.story);
  }

  const merged = new Map<number, DraftFloorLoad>();

  for (const load of existing) {
    merged.set(load.story, { ...load });
  }

  for (const load of incoming) {
    const current = merged.get(load.story);
    merged.set(load.story, {
      story: load.story,
      verticalKN: load.verticalKN ?? current?.verticalKN,
      liveLoadKN: load.liveLoadKN ?? current?.liveLoadKN,
      lateralXKN: load.lateralXKN ?? current?.lateralXKN,
      lateralYKN: load.lateralYKN ?? current?.lateralYKN,
    });
  }

  const normalized = Array.from(merged.values())
    .filter((load) => load.verticalKN !== undefined || load.liveLoadKN !== undefined || load.lateralXKN !== undefined || load.lateralYKN !== undefined)
    .sort((a, b) => a.story - b.story);

  return normalized.length > 0 ? normalized : undefined;
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

export function normalizeLoadPositionM(value: unknown): number | undefined {
  const parsed = normalizeNumber(value);
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }
  return parsed;
}

export function normalizeInferredType(value: unknown): InferredModelType | undefined {
  if (value === 'beam' || value === 'truss' || value === 'portal-frame' || value === 'double-span-beam' || value === 'frame' || value === 'unknown') {
    return value;
  }
  return undefined;
}

export function normalizeFrameDimension(value: unknown): FrameDimension | undefined {
  return value === '2d' || value === '3d' ? value : undefined;
}

export function normalizeFrameBaseSupportType(value: unknown): FrameBaseSupportType | undefined {
  return value === 'fixed' || value === 'pinned' ? value : undefined;
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

export function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = normalizeNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : undefined;
}

export function normalizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((item) => normalizeNumber(item))
    .filter((item): item is number => item !== undefined && item > 0);
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeFloorLoads(value: unknown): DraftFloorLoad[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const shouldInferMissingStory = !value.some((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const row = item as Record<string, unknown>;
    return row.story !== undefined && row.story !== null;
  });
  const normalized = value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const row = item as Record<string, unknown>;
      const hasExplicitStory = row.story !== undefined && row.story !== null;
      const story = hasExplicitStory
        ? normalizePositiveInteger(row.story)
        : shouldInferMissingStory ? index + 1 : undefined;
      if (!story) {
        return null;
      }
      const verticalKN = normalizeNumber(row.verticalKN);
      const liveLoadKN = normalizeNumber(row.liveLoadKN);
      const lateralXKN = normalizeNumber(row.lateralXKN);
      const lateralYKN = normalizeNumber(row.lateralYKN);
      if (verticalKN === undefined && liveLoadKN === undefined && lateralXKN === undefined && lateralYKN === undefined) {
        return null;
      }
      return { story, verticalKN, liveLoadKN, lateralXKN, lateralYKN };
    });
  const filtered = normalized.filter((item) => item !== null) as DraftFloorLoad[];
  return filtered.length > 0 ? filtered : undefined;
}

function buildUnsupportedStructuralType(
  locale: AppLocale,
  key: StructuralTypeKey,
  noteZh: string,
  noteEn: string,
): StructuralTypeMatch {
  return {
    key,
    mappedType: 'unknown',
    supportLevel: 'unsupported',
    supportNote: localize(locale, noteZh, noteEn),
  };
}

export function buildUnknownStructuralType(locale: AppLocale): StructuralTypeMatch {
  return buildUnsupportedStructuralType(
    locale,
    'unknown',
    '我还没有从当前描述中稳定细化出可直接补参的结构草稿。请先说明你希望按梁、桁架、门式刚架还是规则框架这类结构继续处理。',
    'I have not yet refined the current description into a stable structural draft for follow-up guidance. Please tell me whether you want to proceed as a beam, truss, portal frame, or regular frame.'
  );
}

export function detectUnsupportedStructuralTypeByRules(message: string, locale: AppLocale): StructuralTypeMatch | null {
  const text = message.toLowerCase();
  if (text.includes('space frame') || text.includes('网架')) {
    return buildUnsupportedStructuralType(
      locale,
      'space-frame',
      '当前对话补参链路还不直接支持空间网架；如果你愿意，可先收敛成梁、桁架、门式刚架或规则框架进行澄清。',
      'The current guidance flow does not directly support space frames. If acceptable, we can first simplify the problem to a beam, truss, portal frame, or regular frame.'
    );
  }
  if (text.includes('slab') || text.includes('plate') || text.includes('楼板') || text.includes('板')) {
    return buildUnsupportedStructuralType(
      locale,
      'plate-slab',
      '当前补参链路还不直接支持板/楼板模型；请先确认是否可以简化为梁系、框架或桁架问题。',
      'The current guidance flow does not directly support plate or slab models. Please confirm whether the problem can be simplified into beams, frames, or trusses.'
    );
  }
  if (text.includes('shell') || text.includes('壳')) {
    return buildUnsupportedStructuralType(
      locale,
      'shell',
      '当前补参链路还不直接支持壳体模型；请先说明是否可以收敛到梁、桁架或规则框架的近似模型。',
      'The current guidance flow does not directly support shell models. Please clarify whether the problem can be reduced to a beam, truss, or regular-frame approximation.'
    );
  }
  if (text.includes('tower') || text.includes('塔')) {
    return buildUnsupportedStructuralType(
      locale,
      'tower',
      '当前补参链路还不直接支持塔架专用模板；如果只是杆系近似，可先按桁架继续澄清。',
      'The current guidance flow does not directly support tower-specific templates. If a truss approximation is acceptable, we can continue with that.'
    );
  }
  if (text.includes('bridge') || text.includes('桥')) {
    return buildUnsupportedStructuralType(
      locale,
      'bridge',
      '当前补参链路还不直接支持桥梁专用模板；若你只想先讨论主梁近似，可收敛到梁模板。',
      'The current guidance flow does not directly support bridge-specific templates. If you only want a girder-style approximation first, we can narrow the problem to a beam template.'
    );
  }
  return null;
}

export function mergeDraftState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const mergedType = patch.inferredType && patch.inferredType !== 'unknown' ? patch.inferredType : (existing?.inferredType || 'unknown');
  const mergedLength = patch.lengthM ?? existing?.lengthM;
  const mergedSpan = patch.spanLengthM ?? existing?.spanLengthM;
  const spanLengthM = mergedSpan ?? ((mergedType === 'portal-frame' || mergedType === 'double-span-beam') ? mergedLength : undefined);
  const storyCount = patch.storyCount ?? existing?.storyCount ?? patch.storyHeightsM?.length ?? existing?.storyHeightsM?.length;
  const bayCount = patch.bayCount ?? existing?.bayCount ?? patch.bayWidthsM?.length ?? existing?.bayWidthsM?.length;
  const bayCountX = patch.bayCountX ?? existing?.bayCountX ?? patch.bayWidthsXM?.length ?? existing?.bayWidthsXM?.length;
  const bayCountY = patch.bayCountY ?? existing?.bayCountY ?? patch.bayWidthsYM?.length ?? existing?.bayWidthsYM?.length;
  const frameDimension = patch.frameDimension ?? existing?.frameDimension;
  const storyHeightsM = patch.storyHeightsM ?? existing?.storyHeightsM ?? repeatValue(storyCount, patch.heightM ?? existing?.heightM);
  const bayWidthsM = patch.bayWidthsM ?? existing?.bayWidthsM;
  const bayWidthsXM = patch.bayWidthsXM ?? existing?.bayWidthsXM;
  const bayWidthsYM = patch.bayWidthsYM ?? existing?.bayWidthsYM;
  const floorLoads = mergeFloorLoads(existing?.floorLoads, patch.floorLoads);

  return {
    inferredType: mergedType,
    lengthM: mergedLength,
    spanLengthM,
    heightM: patch.heightM ?? existing?.heightM,
    supportType: patch.supportType ?? existing?.supportType,
    frameDimension,
    storyCount,
    bayCount,
    bayCountX,
    bayCountY,
    storyHeightsM,
    bayWidthsM: frameDimension === '2d'
      ? (bayWidthsM ?? repeatValue(bayCount, patch.lengthM ?? existing?.lengthM))
      : undefined,
    bayWidthsXM: frameDimension === '3d' ? bayWidthsXM : undefined,
    bayWidthsYM: frameDimension === '3d' ? bayWidthsYM : undefined,
    floorLoads: floorLoads ?? buildUniformFloorLoads(
      storyCount,
      patch.loadKN ?? existing?.loadKN,
      undefined,
      undefined,
    ),
    frameBaseSupportType: patch.frameBaseSupportType ?? existing?.frameBaseSupportType,
    loadKN: patch.loadKN ?? existing?.loadKN,
    loadType: patch.loadType ?? existing?.loadType,
    loadPosition: patch.loadPosition ?? existing?.loadPosition,
    loadPositionM: patch.loadPositionM ?? existing?.loadPositionM,
    updatedAt: Date.now(),
  };
}


function buildSupportTypeQuestion(locale: AppLocale): string {
  return localize(
    locale,
    '请确认支座/边界条件（悬臂、简支、两端固结或固铰）。',
    'Please confirm the support condition (cantilever, simply supported, fixed-fixed, or fixed-pinned).'
  );
}

function buildLoadTypeQuestion(type: InferredModelType, locale: AppLocale): string {
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

function buildLoadPositionQuestion(type: InferredModelType, locale: AppLocale): string {
  switch (type) {
    case 'beam':
      return localize(locale, '请确认荷载位置（可说端部/跨中/全跨，也可直接给距左端 x m）。', 'Please confirm the load position (end / midspan / full span), or provide an offset x m from the left end.');
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
        return {
          paramKey,
          label: localize(locale, '结构体系', 'Structural system'),
          question: localize(locale, '请描述结构体系与构件连接关系（不限类型）；也可以直接提供可计算的结构模型 JSON。', 'Please describe the structural system and member connectivity (any type). You can also provide a computable structural model JSON directly.'),
          required: true,
          critical,
        };
      case 'lengthM':
        return { paramKey, label: localize(locale, '跨度/长度', 'Span / length'), question: localize(locale, '请确认跨度或长度。', 'Please confirm the span or length.'), unit: 'm', required: true, critical };
      case 'spanLengthM':
        return { paramKey, label: localize(locale, '每跨跨度', 'Span per bay'), question: localize(locale, '请确认门式刚架或双跨梁每跨跨度。', 'Please confirm the span length for each bay of the portal frame or double-span beam.'), unit: 'm', required: true, critical };
      case 'heightM':
        return { paramKey, label: localize(locale, '柱高', 'Column height'), question: localize(locale, '请确认门式刚架柱高。', 'Please confirm the portal-frame column height.'), unit: 'm', required: true, critical };
      case 'supportType':
        return { paramKey, label: localize(locale, '支座条件', 'Support condition'), question: buildSupportTypeQuestion(locale), required: true, critical, suggestedValue: 'simply-supported' };
      case 'frameDimension':
        return { paramKey, label: localize(locale, '框架维度', 'Frame dimension'), question: localize(locale, '请确认这是 2D 平面框架还是 3D 规则轴网框架。', 'Please confirm whether this is a 2D planar frame or a 3D regular-grid frame.'), required: true, critical, suggestedValue: '2d' };
      case 'storyCount':
        return { paramKey, label: localize(locale, '层数', 'Story count'), question: localize(locale, '请确认框架层数。', 'Please confirm the number of stories.'), required: true, critical };
      case 'bayCount':
        return { paramKey, label: localize(locale, '跨数', 'Bay count'), question: localize(locale, '请确认 2D 框架跨数。', 'Please confirm the number of bays for the 2D frame.'), required: true, critical };
      case 'bayCountX':
        return { paramKey, label: localize(locale, 'X向跨数', 'Bay count in X'), question: localize(locale, '请确认 3D 框架 X 向跨数。', 'Please confirm the number of bays in the X direction for the 3D frame.'), required: true, critical };
      case 'bayCountY':
        return { paramKey, label: localize(locale, 'Y向跨数', 'Bay count in Y'), question: localize(locale, '请确认 3D 框架 Y 向跨数。', 'Please confirm the number of bays in the Y direction for the 3D frame.'), required: true, critical };
      case 'storyHeightsM':
        return { paramKey, label: localize(locale, '层高', 'Story heights'), question: localize(locale, '请确认各层层高；若各层相同，也可以直接说“每层 3m”。', 'Please confirm the story heights. If all stories are identical, you can simply say “3 m per story”.'), unit: 'm', required: true, critical };
      case 'bayWidthsM':
        return { paramKey, label: localize(locale, '各跨跨度', 'Bay widths'), question: localize(locale, '请确认 2D 框架各跨跨度；若相同，也可以直接说“每跨 6m”。', 'Please confirm the bay widths for the 2D frame. If all bays are identical, you can simply say “6 m per bay”.'), unit: 'm', required: true, critical };
      case 'bayWidthsXM':
        return { paramKey, label: localize(locale, 'X向各跨跨度', 'Bay widths in X'), question: localize(locale, '请确认 3D 框架 X 向各跨跨度。', 'Please confirm the bay widths in the X direction for the 3D frame.'), unit: 'm', required: true, critical };
      case 'bayWidthsYM':
        return { paramKey, label: localize(locale, 'Y向各跨跨度', 'Bay widths in Y'), question: localize(locale, '请确认 3D 框架 Y 向各跨跨度。', 'Please confirm the bay widths in the Y direction for the 3D frame.'), unit: 'm', required: true, critical };
      case 'floorLoads':
        return { paramKey, label: localize(locale, '各层总荷载', 'Per-floor total load'), question: localize(locale, '请确认各层总荷载（该总荷载将均匀分配到该层所有节点上；至少给出每层竖向荷载；2D 框架可补水平荷载，3D 框架可补 X/Y 向水平荷载）。', 'Please confirm the per-floor total load. The value will be distributed equally across all nodes on that floor. At minimum provide the vertical load for each story; you may also add lateral loads in X for 2D or X/Y for 3D.'), unit: 'kN', required: true, critical };
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

export function buildModel(state: DraftState): Record<string, unknown> {
  return buildDraftModel(state);
}
