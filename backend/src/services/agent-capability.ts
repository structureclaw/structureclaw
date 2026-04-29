import { AnalysisEngineCatalogService } from './analysis-engine.js';
import { AgentSkillCatalogService } from './agent-skill-catalog.js';
import { AgentSkillRuntime } from '../agent-runtime/index.js';
import { normalizeMaterialFamilies as normalizeDomainMaterialFamilies } from '../agent-skills/material/entry.js';
import { ALL_SKILL_DOMAINS } from '../agent-runtime/types.js';
import { listAgentToolDefinitions } from '../agent-langgraph/tool-registry.js';
import type { AgentAnalysisType, MaterialFamily, SkillDomain, SkillManifest, SkillRuntimeStatus } from '../agent-runtime/types.js';
import type { AgentToolDefinition } from '../agent-langgraph/tool-registry.js';
import type { BuiltinSkillCatalogEntry } from './agent-skill-catalog.js';

const ACTIVE_RUNTIME_DOMAINS = new Set<SkillDomain>([
  'structure-type',
  'analysis',
  'code-check',
  'result-postprocess',
]);
const PARTIAL_RUNTIME_DOMAINS = new Set<SkillDomain>([
  'validation',
  'report-export',
  'design',
]);

function resolveDomainRuntimeStatus(domain: SkillDomain, hasDiscoverablePresence: boolean): SkillRuntimeStatus {
  if (ACTIVE_RUNTIME_DOMAINS.has(domain) && hasDiscoverablePresence) {
    return 'active';
  }
  if (PARTIAL_RUNTIME_DOMAINS.has(domain) && hasDiscoverablePresence) {
    return 'partial';
  }
  return hasDiscoverablePresence ? 'discoverable' : 'reserved';
}

interface CapabilitySkill {
  id: string;
  structureType?: string;
  domain: SkillDomain;
  runtimeStatus: SkillRuntimeStatus;
  requires: string[];
  conflicts: string[];
  capabilities: string[];
  supportedAnalysisTypes: AgentAnalysisType[];
  supportedModelFamilies: string[];
  materialFamilies: string[];
  priority: number;
  compatibility: {
    minRuntimeVersion: string;
    skillApiVersion: string;
  };
  stages: string[];
  name: {
    zh?: string;
    en?: string;
  };
}

interface DomainSummary {
  domain: SkillDomain;
  runtimeStatus: SkillRuntimeStatus;
  skillIds: string[];
  capabilities: string[];
}

interface CapabilityTool {
  id: string;
  source: 'builtin';
  category?: string;
  enabledByDefault: boolean;
  requiresSkills: string[];
  requiresTools: string[];
  tags: string[];
  displayName?: {
    zh?: string;
    en?: string;
  };
  description?: {
    zh?: string;
    en?: string;
  };
}

interface CapabilityEngine {
  id: string;
  name?: string;
  enabled: boolean;
  available: boolean;
  status?: string;
  supportedModelFamilies: string[];
  supportedAnalysisTypes: string[];
}

type CapabilityReasonCode =
  | 'engine_disabled'
  | 'engine_unavailable'
  | 'engine_status_unavailable'
  | 'model_family_mismatch'
  | 'analysis_type_mismatch';

type CapabilityAnalysisType = 'static' | 'dynamic' | 'seismic' | 'nonlinear';

const ANALYSIS_TYPES: CapabilityAnalysisType[] = ['static', 'dynamic', 'seismic', 'nonlinear'];

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0)));
}

function toFrontendToolCategory(tool: AgentToolDefinition): string {
  if (tool.id === 'run_analysis') {
    return 'analysis';
  }
  if (tool.id === 'run_code_check') {
    return 'code-check';
  }
  if (tool.id === 'generate_report') {
    return 'report';
  }
  if (tool.category === 'engineering') {
    return 'modeling';
  }
  return 'utility';
}

function assertLocalizedField(value: unknown, field: 'zh' | 'en', ownerLabel: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Malformed capability metadata: ${ownerLabel} is missing a non-empty ${field} value.`);
  }
}

function validateLocalizedText(value: unknown, ownerLabel: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Malformed capability metadata: ${ownerLabel} must be a localized object.`);
  }
  const text = value as Record<string, unknown>;
  assertLocalizedField(text.zh, 'zh', ownerLabel);
  assertLocalizedField(text.en, 'en', ownerLabel);
}

function validateCatalogEntryMetadata(entry: BuiltinSkillCatalogEntry): void {
  validateLocalizedText(entry.name, `skill ${entry.canonicalId} name`);
  validateLocalizedText(entry.description, `skill ${entry.canonicalId} description`);
}

function validateManifestMetadata(manifest: SkillManifest): void {
  validateLocalizedText(manifest.name, `skill ${manifest.id} name`);
  validateLocalizedText(manifest.description, `skill ${manifest.id} description`);
}

function normalizeModelFamilies(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['generic'];
  }
  const normalized = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase());
  return normalized.length > 0 ? normalized : ['generic'];
}

function normalizeAnalysisTypes(value: unknown): AgentAnalysisType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const valid = new Set<AgentAnalysisType>(['static', 'dynamic', 'seismic', 'nonlinear']);
  return value
    .filter((item): item is AgentAnalysisType => typeof item === 'string' && valid.has(item as AgentAnalysisType));
}

function resolveSkillModelFamilies(structureType: string | undefined): string[] {
  if (structureType === 'truss') {
    return ['truss', 'generic'];
  }
  if (structureType === 'frame' || structureType === 'beam' || structureType === 'portal-frame' || structureType === 'double-span-beam') {
    return ['frame', 'generic'];
  }
  return ['generic'];
}

function buildCatalogEntryFromManifest(
  manifest: SkillManifest,
  resolveCanonicalSkillId: (id: string) => string,
): BuiltinSkillCatalogEntry {
  const canonicalId = resolveCanonicalSkillId(manifest.id);
  return {
    id: canonicalId,
    canonicalId,
    aliases: canonicalId === manifest.id ? [] : [manifest.id],
    domain: manifest.domain,
    name: {
      zh: manifest.name?.zh,
      en: manifest.name?.en,
    },
    description: {
      zh: manifest.description?.zh,
      en: manifest.description?.en,
    },
    stages: Array.isArray(manifest.stages) ? [...manifest.stages] : [],
    triggers: Array.isArray(manifest.triggers) ? [...manifest.triggers] : [],
    structureType: manifest.structureType,
    capabilities: Array.isArray(manifest.capabilities) ? [...manifest.capabilities] : [],
    supportedAnalysisTypes: normalizeAnalysisTypes(manifest.supportedAnalysisTypes),
    supportedModelFamilies: Array.isArray(manifest.supportedModelFamilies)
      ? uniqueStrings(manifest.supportedModelFamilies)
      : [],
    materialFamilies: normalizeDomainMaterialFamilies(manifest.materialFamilies),
    priority: manifest.priority ?? 0,
    compatibility: {
      minRuntimeVersion: manifest.compatibility?.minRuntimeVersion || '0.1.0',
      skillApiVersion: manifest.compatibility?.skillApiVersion || 'v1',
    },
    manifestPath: '<runtime>',
  };
}

function toCapabilityTool(tool: AgentToolDefinition): CapabilityTool {
  const category = toFrontendToolCategory(tool);
  return {
    id: tool.id,
    source: 'builtin',
    category,
    enabledByDefault: tool.defaultEnabled,
    requiresSkills: [],
    requiresTools: [],
    tags: [tool.category, tool.risk],
    displayName: {
      zh: tool.displayName?.zh,
      en: tool.displayName?.en,
    },
    description: {
      zh: tool.description?.zh,
      en: tool.description?.en,
    },
  };
}

function evaluateEngineForSkill(
  engine: CapabilityEngine,
  requiredFamilies: Set<string>,
  analysisType?: CapabilityAnalysisType,
): { compatible: boolean; reasons: CapabilityReasonCode[] } {
  const reasons: CapabilityReasonCode[] = [];
  if (!engine.enabled) {
    reasons.push('engine_disabled');
  }
  if (!engine.available) {
    reasons.push('engine_unavailable');
  }
  if (engine.status === 'disabled' || engine.status === 'unavailable') {
    reasons.push('engine_status_unavailable');
  }
  if (!engine.supportedModelFamilies.some((family) => requiredFamilies.has(family))) {
    reasons.push('model_family_mismatch');
  }
  if (analysisType && engine.supportedAnalysisTypes.length > 0 && !engine.supportedAnalysisTypes.includes(analysisType)) {
    reasons.push('analysis_type_mismatch');
  }
  return {
    compatible: reasons.length === 0,
    reasons,
  };
}

function recommendedToolIdsForSkill(skill: CapabilitySkill): string[] {
  if (skill.domain === 'analysis') {
    return ['build_model', 'validate_model', 'run_analysis', 'generate_report'];
  }
  if (skill.domain === 'code-check') {
    return ['build_model', 'validate_model', 'run_analysis', 'run_code_check', 'generate_report'];
  }
  if (skill.domain === 'report-export') {
    return ['generate_report'];
  }
  if (skill.domain === 'validation') {
    return ['validate_model'];
  }
  if (skill.domain === 'structure-type') {
    return ['detect_structure_type', 'extract_draft_params', 'build_model', 'validate_model', 'run_analysis', 'generate_report'];
  }
  return [];
}

export class AgentCapabilityService {
  private readonly skillRuntime: AgentSkillRuntime;
  private readonly skillCatalog: AgentSkillCatalogService;
  private readonly engineCatalog: AnalysisEngineCatalogService;

  constructor(
    skillRuntime = new AgentSkillRuntime(),
    skillCatalog = new AgentSkillCatalogService(),
    toolCatalogOrEngineCatalog?: unknown,
    engineCatalog?: AnalysisEngineCatalogService,
  ) {
    this.skillRuntime = skillRuntime;
    this.skillCatalog = skillCatalog;
    this.engineCatalog = engineCatalog
      ?? (toolCatalogOrEngineCatalog && typeof (toolCatalogOrEngineCatalog as { listEngines?: unknown }).listEngines === 'function'
        ? toolCatalogOrEngineCatalog as AnalysisEngineCatalogService
        : new AnalysisEngineCatalogService());
  }

  async getCapabilityMatrix(options?: { analysisType?: CapabilityAnalysisType }) {
    const runtimeSkills = this.skillRuntime.listSkills();
    const staticCatalogEntries = await this.skillCatalog.listBuiltinSkills();
    const manifests = await this.skillRuntime.listSkillManifests();
    staticCatalogEntries.forEach(validateCatalogEntryMetadata);
    manifests.forEach(validateManifestMetadata);
    const resolveCanonicalSkillId = (id: string) => this.skillCatalog.resolveCanonicalSkillId(id);
    const catalogEntryByCanonicalId = new Map<string, BuiltinSkillCatalogEntry>(
      staticCatalogEntries.map((entry) => [entry.canonicalId, entry]),
    );
    for (const manifest of manifests) {
      const canonicalId = resolveCanonicalSkillId(manifest.id);
      if (!catalogEntryByCanonicalId.has(canonicalId)) {
        catalogEntryByCanonicalId.set(canonicalId, buildCatalogEntryFromManifest(manifest, resolveCanonicalSkillId));
      }
    }
    const catalogEntries = Array.from(catalogEntryByCanonicalId.values()).sort((left, right) =>
      left.domain.localeCompare(right.domain)
      || right.priority - left.priority
      || left.canonicalId.localeCompare(right.canonicalId),
    );
    const discoverableDomains = new Set<SkillDomain>([
      ...catalogEntries.map((entry) => entry.domain),
      ...runtimeSkills
        .map((skill) => skill.domain)
        .filter((domain): domain is SkillDomain => typeof domain === 'string'),
    ]);
    const manifestByCanonicalId = new Map<string, SkillManifest>(
      manifests.map((manifest) => [resolveCanonicalSkillId(manifest.id), manifest]),
    );
    const toolDefinitions = listAgentToolDefinitions();
    const defaultToolIds = toolDefinitions
      .filter((tool) => tool.defaultEnabled)
      .map((tool) => tool.id)
      .sort();
    const tools = toolDefinitions
      .map((tool) => toCapabilityTool(tool))
      .sort((a, b) => a.id.localeCompare(b.id));
    const skillIdsByToolId = defaultToolIds.reduce<Record<string, string[]>>((acc, toolId) => {
      acc[toolId] = catalogEntries.map((entry) => entry.canonicalId);
      return acc;
    }, {});

    const skills: CapabilitySkill[] = catalogEntries.map((entry: BuiltinSkillCatalogEntry) => {
      const manifest = manifestByCanonicalId.get(entry.canonicalId);
      return {
        id: entry.canonicalId,
        structureType: entry.structureType,
        domain: entry.domain,
        runtimeStatus: resolveDomainRuntimeStatus(entry.domain, discoverableDomains.has(entry.domain)),
        requires: Array.isArray(manifest?.requires) ? [...manifest.requires] : [],
        conflicts: Array.isArray(manifest?.conflicts) ? [...manifest.conflicts] : [],
        capabilities: uniqueStrings(entry.capabilities),
        supportedAnalysisTypes: normalizeAnalysisTypes(entry.supportedAnalysisTypes as AgentAnalysisType[]),
        supportedModelFamilies: entry.supportedModelFamilies.length > 0
          ? uniqueStrings(entry.supportedModelFamilies)
          : resolveSkillModelFamilies(entry.structureType),
        materialFamilies: normalizeDomainMaterialFamilies(entry.materialFamilies as MaterialFamily[]),
        priority: entry.priority ?? 0,
        compatibility: {
          minRuntimeVersion: entry.compatibility.minRuntimeVersion,
          skillApiVersion: entry.compatibility.skillApiVersion,
        },
        stages: uniqueStrings(entry.stages),
        name: {
          zh: entry.name?.zh,
          en: entry.name?.en,
        },
      };
    });
    const enabledToolIdsBySkill = skills.reduce<Record<string, string[]>>((acc, skill) => {
      acc[skill.id] = recommendedToolIdsForSkill(skill);
      return acc;
    }, {});
    const skillAliasesByCanonicalId = catalogEntries.reduce<Record<string, string[]>>((acc, entry) => {
      acc[entry.canonicalId] = uniqueStrings(entry.aliases).sort();
      return acc;
    }, {});
    const canonicalSkillIdByAlias = catalogEntries.reduce<Record<string, string>>((acc, entry) => {
      for (const alias of uniqueStrings(entry.aliases)) {
        acc[alias] = entry.canonicalId;
      }
      return acc;
    }, {});

    let rawEngines: Record<string, unknown>[];
    try {
      const enginePayload = await this.engineCatalog.listEngines();
      rawEngines = Array.isArray(enginePayload?.engines)
        ? enginePayload.engines.map((engine) => engine as unknown as Record<string, unknown>)
        : [];
    } catch {
      rawEngines = [];
    }
    const engines: CapabilityEngine[] = rawEngines
      .filter((engine) => typeof engine.id === 'string' && engine.id.trim().length > 0)
      .map((engine) => ({
        id: String(engine.id),
        name: typeof engine.name === 'string' ? engine.name : undefined,
        enabled: engine.enabled !== false,
        available: engine.available !== false,
        status: typeof engine.status === 'string' ? engine.status : undefined,
        supportedModelFamilies: normalizeModelFamilies(engine.supportedModelFamilies),
        supportedAnalysisTypes: normalizeAnalysisTypes(engine.supportedAnalysisTypes),
      }));

    const validEngineIdsBySkill: Record<string, string[]> = {};
    const filteredEngineReasonsBySkill: Record<string, Record<string, CapabilityReasonCode[]>> = {};
    for (const skill of skills) {
      const requiredFamilies = new Set(
        skill.supportedModelFamilies.length > 0
          ? skill.supportedModelFamilies
          : resolveSkillModelFamilies(skill.structureType),
      );
      const validEngineIds: string[] = [];
      const reasonMap: Record<string, CapabilityReasonCode[]> = {};
      for (const engine of engines) {
        const evaluation = evaluateEngineForSkill(engine, requiredFamilies, options?.analysisType);
        if (evaluation.compatible) {
          validEngineIds.push(engine.id);
        } else {
          reasonMap[engine.id] = evaluation.reasons;
        }
      }
      validEngineIdsBySkill[skill.id] = validEngineIds;
      filteredEngineReasonsBySkill[skill.id] = reasonMap;
    }

    const validSkillIdsByEngine: Record<string, string[]> = {};
    for (const engine of engines) {
      const familySet = new Set(engine.supportedModelFamilies);
      validSkillIdsByEngine[engine.id] = skills
        .filter((skill) => {
          const requiredFamilies = skill.supportedModelFamilies.length > 0
            ? skill.supportedModelFamilies
            : resolveSkillModelFamilies(skill.structureType);
          return requiredFamilies.some((family) => familySet.has(family));
        })
        .map((skill) => skill.id);
    }

    const domainSummaryMap = new Map<SkillDomain, DomainSummary>(
      ALL_SKILL_DOMAINS.map((domain) => [domain, {
        domain,
        runtimeStatus: resolveDomainRuntimeStatus(domain, discoverableDomains.has(domain)),
        skillIds: [],
        capabilities: [],
      }]),
    );
    for (const skill of skills) {
      const existing = domainSummaryMap.get(skill.domain);
      if (!existing) {
        continue;
      }
      existing.skillIds.push(skill.id);
      existing.capabilities = Array.from(new Set([...existing.capabilities, ...skill.capabilities]));
    }

    const domainSummaries = [...domainSummaryMap.values()]
      .map((summary) => ({
        ...summary,
        skillIds: [...summary.skillIds].sort(),
        capabilities: [...summary.capabilities].sort(),
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    const skillDomainById = skills.reduce<Record<string, SkillDomain>>((acc, skill) => {
      acc[skill.id] = skill.domain;
      return acc;
    }, {});

    const analysisSkillsByType = skills.filter((skill) => skill.domain === 'analysis');
    const analysisCompatibility = ANALYSIS_TYPES.reduce<Record<CapabilityAnalysisType, {
      skillIds: string[];
      compatibleEngineIds: string[];
      baselinePolicyAvailable: boolean;
    }>>((acc, analysisType) => {
      const skillIds = analysisSkillsByType
        .filter((skill) => skill.supportedAnalysisTypes.length === 0 || skill.supportedAnalysisTypes.includes(analysisType))
        .map((skill) => skill.id)
        .sort();
      const compatibleEngineIds = engines
        .filter((engine) => engine.enabled && engine.available && engine.supportedAnalysisTypes.includes(analysisType))
        .map((engine) => engine.id)
        .sort();

      acc[analysisType] = {
        skillIds,
        compatibleEngineIds,
        baselinePolicyAvailable: true,
      };
      return acc;
    }, {
      static: { skillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
      dynamic: { skillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
      seismic: { skillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
      nonlinear: { skillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
    });

    return {
      generatedAt: new Date().toISOString(),
      skills,
      tools,
      engines,
      domainSummaries,
      validEngineIdsBySkill,
      filteredEngineReasonsBySkill,
      validSkillIdsByEngine,
      skillDomainById,
      enabledToolIdsBySkill,
      skillIdsByToolId,
      skillAliasesByCanonicalId,
      canonicalSkillIdByAlias,
      analysisCompatibility,
      appliedAnalysisType: options?.analysisType,
    };
  }
}

export default AgentCapabilityService;
