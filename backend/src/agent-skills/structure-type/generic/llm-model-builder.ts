import type { AppLocale } from '../../../services/locale.js';
import type { DraftState } from '../../../agent-runtime/types.js';
import { STRUCTURAL_COORDINATE_SEMANTICS } from '../../../agent-runtime/coordinate-semantics.js';
import { logger } from '../../../utils/logger.js';
import type { StructureClawChatModel } from '../../../utils/llm.js';
import { buildGenericModelPrompt, buildRetrySuffix } from './llm-model-prompt.js';

export async function tryBuildGenericModelWithLlm(
  llm: StructureClawChatModel | null,
  message: string,
  state: DraftState,
  locale: AppLocale,
  conversationHistory?: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  if (!llm) {
    return undefined;
  }

  const basePrompt = buildGenericModelPrompt(message, state, locale, conversationHistory);
  const retrySuffix = buildRetrySuffix(locale);
  const stateHint = JSON.stringify(state);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0 ? basePrompt : `${basePrompt}${retrySuffix}`;
    const startedAt = Date.now();
    logger.info({
      attempt: attempt + 1,
      locale,
      promptChars: prompt.length,
      stateHintChars: stateHint.length,
      messagePreview: message.slice(0, 160),
    }, 'generic llm model attempt started');

    try {
      const aiMessage = await llm.invoke(prompt, { signal });
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      const parsed = parseJsonObject(content);
      if (!parsed) {
        logger.warn({
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          responseChars: content.length,
          responsePreview: content.slice(0, 200),
        }, 'generic llm model returned non-json content');
        continue;
      }

      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.elements) || !Array.isArray(parsed.load_cases)) {
        logger.warn({
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          hasNodes: Array.isArray(parsed.nodes),
          hasElements: Array.isArray(parsed.elements),
          hasLoadCases: Array.isArray(parsed.load_cases),
        }, 'generic llm model returned json without required structural arrays');
        continue;
      }

      canonicalizeGenericModel(parsed);
      stampCanonicalMetadata(parsed, state);

      logger.info({
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        nodeCount: parsed.nodes.length,
        elementCount: parsed.elements.length,
        loadCaseCount: parsed.load_cases.length,
      }, 'generic llm model attempt succeeded');

      return parsed;
    } catch (error) {
      logger.warn({
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }, 'generic llm model attempt failed with upstream error');
      continue;
    }
  }

  logger.warn({
    locale,
    promptChars: basePrompt.length,
    messagePreview: message.slice(0, 160),
  }, 'generic llm model exhausted all attempts without a valid model');

  return undefined;
}

function canonicalizeGenericModel(model: Record<string, unknown>): void {
  model.schema_version = '2.0.0';
  model.unit_system = 'SI';
  normalizeLikely2DVerticalAxis(model);
  if (!Array.isArray(model.load_cases)) {
    return;
  }
  model.load_cases = model.load_cases.map((loadCase) => {
    if (!loadCase || typeof loadCase !== 'object' || Array.isArray(loadCase)) {
      return loadCase;
    }
    const record = loadCase as Record<string, unknown>;
    return {
      ...record,
      loads: Array.isArray(record.loads)
        ? record.loads.map((load) => normalizeLoadRecord(load))
        : [],
    };
  });
}

function normalizeLikely2DVerticalAxis(model: Record<string, unknown>): void {
  if (!shouldSwapYzFor2DVerticalModel(model)) {
    return;
  }

  const rawNodes = model.nodes;
  if (!Array.isArray(rawNodes)) {
    return;
  }
  rawNodes.forEach((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    const record = node as Record<string, unknown>;
    const y = coordinateValueOrZero(record.y);
    const z = coordinateValueOrZero(record.z);
    record.y = z;
    record.z = y;
    normalizeRestraintsVerticalAxis(record);
  });

  if (Array.isArray(model.load_cases)) {
    model.load_cases.forEach((loadCase) => {
      if (!loadCase || typeof loadCase !== 'object' || Array.isArray(loadCase)) {
        return;
      }
      const loads = (loadCase as Record<string, unknown>).loads;
      if (!Array.isArray(loads)) {
        return;
      }
      loads.forEach(normalizeLoadVerticalAxis);
    });
  }

  const metadata = (
    model.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
      ? model.metadata as Record<string, unknown>
      : {}
  );
  metadata.coordinateRepair = 'swapped-y-z-for-2d-vertical-model';
  model.metadata = metadata;
}

function shouldSwapYzFor2DVerticalModel(model: Record<string, unknown>): boolean {
  if (!Array.isArray(model.nodes)) {
    return false;
  }

  const nodes = model.nodes.filter((node): node is Record<string, unknown> => (
    !!node && typeof node === 'object' && !Array.isArray(node)
  ));
  if (nodes.length < 2) {
    return false;
  }

  const yValues = nodes.map((node) => coordinateValueOrZero(node.y)).filter((value): value is number => value !== null);
  const zValues = nodes.map((node) => coordinateValueOrZero(node.z)).filter((value): value is number => value !== null);
  if (yValues.length !== nodes.length || zValues.length !== nodes.length) {
    return false;
  }

  const ySpan = valueSpan(yValues);
  const zSpan = valueSpan(zValues);
  return ySpan > 0.1 && zSpan < 1e-6;
}

function normalizeLoadVerticalAxis(load: unknown): void {
  if (!load || typeof load !== 'object' || Array.isArray(load)) {
    return;
  }
  const record = load as Record<string, unknown>;
  moveVerticalComponentIfNeeded(record, 'fy', 'fz');
  moveVerticalComponentIfNeeded(record, 'wy', 'wz');
  moveVerticalComponentIfNeeded(record, 'qy', 'qz');
  moveVerticalComponentIfNeeded(record, 'py', 'pz');
  moveVerticalComponentIfNeeded(record, 'mz', 'my');
}

function normalizeRestraintsVerticalAxis(record: Record<string, unknown>): void {
  const restraints = record.restraints;
  if (!Array.isArray(restraints) || restraints.length !== 6) {
    return;
  }
  swapArrayItems(restraints, 1, 2);
  swapArrayItems(restraints, 4, 5);
}

function swapArrayItems(values: unknown[], left: number, right: number): void {
  const value = values[left];
  values[left] = values[right];
  values[right] = value;
}

function moveVerticalComponentIfNeeded(record: Record<string, unknown>, yKey: string, zKey: string): void {
  const yValue = toFiniteNumber(record[yKey]);
  const zValue = toFiniteNumber(record[zKey]);
  if (yValue !== null && Math.abs(yValue) > 1e-9 && (zValue === null || Math.abs(zValue) <= 1e-9)) {
    record[zKey] = record[yKey];
    record[yKey] = typeof record[yKey] === 'string' ? '0' : 0;
  }
}

function normalizeLoadRecord(load: unknown): unknown {
  if (!load || typeof load !== 'object' || Array.isArray(load)) {
    return load;
  }

  const record = { ...(load as Record<string, unknown>) };
  if (record.type === 'nodal_force') {
    record.type = 'nodal';
  } else if (record.type === 'line_load' || record.type === 'element_uniform_load' || record.type === 'uniform_load') {
    record.type = 'distributed';
  }

  const unit = firstString(record.unit, record.forceUnit, record.force_unit, record.units);
  if (unit && isNewtonUnit(unit)) {
    const scale = 1 / 1000;
    const numericFields = isDistributedLoad(record)
      ? ['wx', 'wy', 'wz', 'qx', 'qy', 'qz', 'w', 'q', 'value', 'magnitude']
      : ['fx', 'fy', 'fz', 'px', 'py', 'pz', 'mx', 'my', 'mz', 'value', 'magnitude'];
    if (shouldScaleNewtonValues(record, numericFields)) {
      for (const field of numericFields) {
        record[field] = scaleNumber(record[field], scale);
      }
      if (Array.isArray(record.forces)) {
        record.forces = record.forces.map((value) => scaleNumber(value, scale));
      }
    }
    record.unit = canonicalNewtonUnit(unit);
  }
  delete record.forceUnit;
  delete record.force_unit;
  delete record.units;

  return record;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function isNewtonUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase().replace(/\s+/g, '');
  return normalized === 'n' || normalized === 'n/m' || normalized === 'npermeter';
}

function canonicalNewtonUnit(unit: string): 'kN' | 'kN/m' {
  const normalized = unit.trim().toLowerCase().replace(/\s+/g, '');
  return normalized === 'n/m' || normalized === 'npermeter' ? 'kN/m' : 'kN';
}

function isDistributedLoad(load: Record<string, unknown>): boolean {
  return load.type === 'distributed' || load.element !== undefined || load.elementId !== undefined || load.element_id !== undefined;
}

function shouldScaleNewtonValues(record: Record<string, unknown>, fields: string[]): boolean {
  const values = fields
    .map((field) => toFiniteNumber(record[field]))
    .filter((value): value is number => value !== null);
  if (Array.isArray(record.forces)) {
    for (const value of record.forces) {
      const numeric = toFiniteNumber(value);
      if (numeric !== null) {
        values.push(numeric);
      }
    }
  }
  return values.some((value) => Math.abs(value) >= 1000);
}

function scaleNumber(value: unknown, scale: number): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * scale;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return value;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed * scale : value;
  }
  return value;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return tryParseJson(fenced[1]);
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return tryParseJson(trimmed.slice(first, last + 1));
  }
  return null;
}

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function stampCanonicalMetadata(model: Record<string, unknown>, state: DraftState): void {
  const nextMetadata = (
    model.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
      ? { ...(model.metadata as Record<string, unknown>) }
      : {}
  );

  nextMetadata.coordinateSemantics = STRUCTURAL_COORDINATE_SEMANTICS;
  if (nextMetadata.frameDimension !== '2d' && nextMetadata.frameDimension !== '3d') {
    nextMetadata.frameDimension = inferFrameDimension(model);
  }
  if (
    (typeof nextMetadata.inferredType !== 'string' || nextMetadata.inferredType.trim().length === 0)
    && typeof state.inferredType === 'string'
    && state.inferredType !== 'unknown'
  ) {
    nextMetadata.inferredType = state.inferredType;
  }
  if (typeof nextMetadata.source !== 'string' || nextMetadata.source.trim().length === 0) {
    nextMetadata.source = 'generic-llm-draft';
  }

  model.metadata = nextMetadata;
}

function inferFrameDimension(model: Record<string, unknown>): '2d' | '3d' {
  const nodes = Array.isArray(model.nodes) ? model.nodes : [];
  const yValues = new Set<string>();
  const zValues = new Set<string>();

  nodes.forEach((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    const record = node as Record<string, unknown>;
    const y = toFiniteNumber(record.y);
    const z = toFiniteNumber(record.z);
    if (y !== null) {
      yValues.add(y.toFixed(6));
    }
    if (z !== null) {
      zValues.add(z.toFixed(6));
    }
  });

  return yValues.size > 1 && zValues.size > 1 ? '3d' : '2d';
}

function valueSpan(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function coordinateValueOrZero(value: unknown): number | null {
  return value === undefined || value === null ? 0 : toFiniteNumber(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}
