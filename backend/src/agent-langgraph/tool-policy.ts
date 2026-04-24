import { listAgentToolDefinitions } from './tool-registry.js';

export interface ResolveActiveToolIdsInput {
  requestedEnabledToolIds?: string[];
  requestedDisabledToolIds?: string[];
  selectedSkillIds?: string[];
  allowShell: boolean;
}

export interface ResolveActiveToolIdsResult {
  activeToolIds: string[];
  deniedToolIds: Record<string, string[]>;
  unknownToolIds: string[];
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set(
    (values || [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ));
}

function addDenied(deniedToolIds: Record<string, string[]>, toolId: string, reason: string): void {
  deniedToolIds[toolId] = [...(deniedToolIds[toolId] || []), reason];
}

const LEGACY_TOOL_IDS = new Set([
  'convert_model',
  'draft_model',
  'enrich_model',
  'generate_drawing',
  'postprocess_result',
  'read_workspace_file',
  'synthesize_design',
  'update_model',
  'update_session_config',
  'write_workspace_file',
  'list_workspace_files',
]);

export function resolveActiveToolIds(input: ResolveActiveToolIdsInput): ResolveActiveToolIdsResult {
  const definitions = listAgentToolDefinitions();
  const known = new Map(definitions.map((definition) => [definition.id, definition]));
  const requestedEnabled = input.requestedEnabledToolIds === undefined
    ? undefined
    : uniqueStrings(input.requestedEnabledToolIds);
  const requestedDisabled = new Set(uniqueStrings(input.requestedDisabledToolIds));
  const defaultToolIds = definitions
    .filter((definition) => definition.defaultEnabled)
    .map((definition) => definition.id);
  const containsLegacyToolIds = requestedEnabled?.some((toolId) => LEGACY_TOOL_IDS.has(toolId)) ?? false;
  const baseIds = requestedEnabled === undefined
    ? defaultToolIds
    : containsLegacyToolIds
      ? [...defaultToolIds, ...requestedEnabled]
      : requestedEnabled;
  const deniedToolIds: Record<string, string[]> = {};
  const activeToolIds: string[] = [];
  const unknownToolIds: string[] = [];

  for (const toolId of baseIds) {
    if (LEGACY_TOOL_IDS.has(toolId)) {
      addDenied(deniedToolIds, toolId, 'LEGACY_TOOL_ID_IGNORED');
      continue;
    }
    const definition = known.get(toolId);
    if (!definition) {
      unknownToolIds.push(toolId);
      continue;
    }
    if (requestedDisabled.has(toolId)) {
      addDenied(deniedToolIds, toolId, 'DISABLED_BY_REQUEST');
      continue;
    }
    if (definition.requiresShellGate && !input.allowShell) {
      addDenied(deniedToolIds, toolId, 'SHELL_DISABLED');
      continue;
    }
    if (definition.requiresExplicitEnable && requestedEnabled === undefined) {
      addDenied(deniedToolIds, toolId, 'EXPLICIT_ENABLE_REQUIRED');
      continue;
    }
    activeToolIds.push(toolId);
  }

  for (const toolId of requestedDisabled) {
    if (!known.has(toolId)) unknownToolIds.push(toolId);
  }

  return {
    activeToolIds: Array.from(new Set(activeToolIds)).sort(),
    deniedToolIds,
    unknownToolIds: Array.from(new Set(unknownToolIds)).sort(),
  };
}
