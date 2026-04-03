import type { AppLocale } from '../services/locale.js';
import type { DraftState } from './types.js';
import { localize } from './plugin-helpers.js';

export function computeMissingCriticalKeys(state: DraftState): string[] {
  const missing: string[] = [];
  if (state.inferredType === 'unknown') {
    missing.push('inferredType');
    return missing;
  }
  if (state.inferredType === 'frame') {
    if (state.frameDimension === undefined) {
      missing.push('frameDimension');
    }
    if (state.storyCount === undefined && !state.storyHeightsM?.length) {
      missing.push('storyCount');
    }
    if (!state.storyHeightsM?.length) {
      missing.push('storyHeightsM');
    }
    if (state.frameDimension === '2d') {
      if (state.bayCount === undefined && !state.bayWidthsM?.length) {
        missing.push('bayCount');
      }
      if (!state.bayWidthsM?.length) {
        missing.push('bayWidthsM');
      }
    } else if (state.frameDimension === '3d') {
      if (state.bayCountX === undefined && !state.bayWidthsXM?.length) {
        missing.push('bayCountX');
      }
      if (!state.bayWidthsXM?.length) {
        missing.push('bayWidthsXM');
      }
      if (state.bayCountY === undefined && !state.bayWidthsYM?.length) {
        missing.push('bayCountY');
      }
      if (!state.bayWidthsYM?.length) {
        missing.push('bayWidthsYM');
      }
    }
    if (!state.floorLoads?.length) {
      missing.push('floorLoads');
    }
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
  if (state.inferredType === 'unknown' || state.inferredType === 'frame') {
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
        return localize(locale, '结构体系/构件拓扑描述（不限类型，可直接给结构模型JSON）', 'Structural system / topology description (any type, or provide computable model JSON directly)');
      case 'lengthM':
        return localize(locale, '跨度/长度（m）', 'Span / length (m)');
      case 'spanLengthM':
        return localize(locale, '门式刚架或双跨每跨跨度（m）', 'Span length per bay for the portal frame or double-span beam (m)');
      case 'heightM':
        return localize(locale, '门式刚架柱高（m）', 'Portal-frame column height (m)');
      case 'supportType':
        return localize(locale, '支座/边界条件（悬臂/简支/两端固结/固铰）', 'Support condition (cantilever / simply supported / fixed-fixed / fixed-pinned)');
      case 'frameDimension':
        return localize(locale, '框架维度（2D/3D）', 'Frame dimension (2D / 3D)');
      case 'storyCount':
        return localize(locale, '层数', 'Story count');
      case 'bayCount':
        return localize(locale, '跨数', 'Bay count');
      case 'bayCountX':
        return localize(locale, 'X向跨数', 'Bay count in X');
      case 'bayCountY':
        return localize(locale, 'Y向跨数', 'Bay count in Y');
      case 'storyHeightsM':
        return localize(locale, '各层层高（m）', 'Story heights (m)');
      case 'bayWidthsM':
        return localize(locale, '各跨跨度（m）', 'Bay widths (m)');
      case 'bayWidthsXM':
        return localize(locale, 'X向各跨跨度（m）', 'Bay widths in X (m)');
      case 'bayWidthsYM':
        return localize(locale, 'Y向各跨跨度（m）', 'Bay widths in Y (m)');
      case 'floorLoads':
        return localize(locale, '各层总荷载（kN）', 'Per-floor total loads (kN)');
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
