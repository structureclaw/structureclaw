import { AnalysisEngineCatalogService } from './analysis-engine.js';
import { AgentSkillCatalogService } from './agent-skill-catalog.js';
import { AgentToolCatalogService } from './agent-tool-catalog.js';
import { AgentSkillRuntime } from '../agent-runtime/index.js';
import { normalizeAnalysisTypes as normalizeDomainAnalysisTypes } from '../agent-skills/design/entry.js';
import { normalizeMaterialFamilies as normalizeDomainMaterialFamilies } from '../agent-skills/material/entry.js';
import { ALL_SKILL_DOMAINS } from '../agent-runtime/types.js';
import type { AgentAnalysisType, MaterialFamily, SkillDomain, SkillManifest, SkillRuntimeStatus, ToolManifest } from '../agent-runtime/types.js';
import type { BuiltinSkillCatalogEntry } from './agent-skill-catalog.js';
import type { LoadedToolManifest } from '../agent-runtime/tool-manifest-loader.js';

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
  autoLoadByDefault: boolean;
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
  autoLoadSkillIds: string[];
  capabilities: string[];
}

interface CapabilityTool {
  id: string;
  source: ToolManifest['source'];
  category?: ToolManifest['category'];
  enabledByDefault: boolean;
  providedBySkillId?: string;
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
const FOUNDATION_TOOL_IDS = ['convert_model'] as const;

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0)));
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

function normalizeAnalysisTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase());
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
    autoLoadByDefault: Boolean(manifest.autoLoadByDefault),
    structureType: manifest.structureType,
    capabilities: Array.isArray(manifest.capabilities) ? [...manifest.capabilities] : [],
    enabledTools: Array.isArray(manifest.enabledTools) ? [...manifest.enabledTools] : [],
    providedTools: Array.isArray(manifest.providedTools) ? [...manifest.providedTools] : [],
    supportedAnalysisTypes: normalizeDomainAnalysisTypes(manifest.supportedAnalysisTypes),
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

function assertKnownCapabilityTool(toolId: string, skillId: string): never {
  throw new Error(`Capability matrix referenced unknown tool "${toolId}" for skill "${skillId}".`);
}

function canonicalizeSkillIds(skillIds: readonly string[] | undefined, resolveCanonicalSkillId: (id: string) => string): string[] {
  if (!Array.isArray(skillIds)) {
    return [];
  }
  return uniqueStrings(skillIds.map((skillId) => resolveCanonicalSkillId(skillId))).sort();
}

type CapabilityToolManifestLike = Pick<
  ToolManifest,
  'id' | 'source' | 'category' | 'enabledByDefault' | 'providedBySkillId' | 'requiresSkills' | 'requiresTools' | 'tags' | 'displayName' | 'description'
>;

type CapabilityToolInput = (CapabilityToolManifestLike | LoadedToolManifest) & {
  providedBySkillId?: string;
};

function toCapabilityTool(tool: CapabilityToolInput, resolveCanonicalSkillId: (id: string) => string): CapabilityTool {
  return {
    id: tool.id,
    source: tool.source,
    category: tool.category,
    enabledByDefault: tool.enabledByDefault,
    providedBySkillId: typeof tool.providedBySkillId === 'string'
      ? resolveCanonicalSkillId(tool.providedBySkillId)
      : undefined,
    requiresSkills: canonicalizeSkillIds(tool.requiresSkills, resolveCanonicalSkillId),
    requiresTools: Array.isArray(tool.requiresTools) ? [...tool.requiresTools] : [],
    tags: Array.isArray(tool.tags) ? [...tool.tags] : [],
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

export class AgentCapabilityService {
  constructor(
    private readonly skillRuntime = new AgentSkillRuntime(),
    private readonly skillCatalog = new AgentSkillCatalogService(),
    private readonly toolCatalog = new AgentToolCatalogService(),
    private readonly engineCatalog = new AnalysisEngineCatalogService(),
  ) {}

  async getCapabilityMatrix(options?: { analysisType?: CapabilityAnalysisType }) {
    const runtimeSkills = this.skillRuntime.listSkills();
    const staticCatalogEntries = await this.skillCatalog.listBuiltinSkills();
    const manifests = await this.skillRuntime.listSkillManifests();
    staticCatalogEntries.forEach(validateCatalogEntryMetadata);
    manifests.forEach(validateManifestMetadata);
    const runtimeTooling = await this.skillRuntime.resolveSkillTooling(manifests.map((manifest) => manifest.id));
    const builtinTools = await this.toolCatalog.listBuiltinTools();
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
    const toolById = new Map<string, CapabilityTool>();
    const builtinToolById = new Map<string, LoadedToolManifest>(builtinTools.map((tool) => [tool.id, tool]));

    for (const tool of builtinTools) {
      toolById.set(tool.id, toCapabilityTool(tool, resolveCanonicalSkillId));
    }

    for (const tool of runtimeTooling.tools) {
      if (builtinToolById.has(tool.id)) {
        continue;
      }
      toolById.set(tool.id, toCapabilityTool(tool, resolveCanonicalSkillId));
    }

    const enableToolForSkill = (toolId: string, skillId: string, relation: 'enabled' | 'provided') => {
      const existing = toolById.get(toolId);
      if (!existing) {
        const builtin = builtinToolById.get(toolId);
        if (!builtin) {
          assertKnownCapabilityTool(toolId, skillId);
        }
        toolById.set(toolId, toCapabilityTool(builtin, resolveCanonicalSkillId));
      }
      if (relation === 'provided') {
        const current = toolById.get(toolId);
        if (current) {
          toolById.set(toolId, {
            ...current,
            providedBySkillId: current.providedBySkillId ?? skillId,
            requiresSkills: uniqueStrings([...current.requiresSkills, skillId]).sort(),
          });
        }
      }
    };

    const enabledToolIdsBySkill = catalogEntries.reduce<Record<string, string[]>>((acc, entry) => {
      const skillId = entry.canonicalId;
      const enabledToolIds = uniqueStrings(entry.enabledTools).sort();
      acc[skillId] = enabledToolIds;
      for (const toolId of enabledToolIds) {
        enableToolForSkill(toolId, skillId, 'enabled');
      }
      return acc;
    }, {});
    const providedToolIdsBySkill = catalogEntries.reduce<Record<string, string[]>>((acc, entry) => {
      const skillId = entry.canonicalId;
      const providedToolIds = uniqueStrings(entry.providedTools).sort();
      acc[skillId] = providedToolIds;
      for (const toolId of providedToolIds) {
        enableToolForSkill(toolId, skillId, 'provided');
      }
      return acc;
    }, {});
    const skillIdsByToolId = catalogEntries.reduce<Record<string, string[]>>((acc, entry) => {
      const skillId = entry.canonicalId;
      for (const toolId of uniqueStrings([...entry.enabledTools, ...entry.providedTools]).sort()) {
        acc[toolId] = uniqueStrings([...(acc[toolId] || []), skillId]).sort();
      }
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
        supportedAnalysisTypes: normalizeDomainAnalysisTypes(entry.supportedAnalysisTypes as AgentAnalysisType[]),
        supportedModelFamilies: entry.supportedModelFamilies.length > 0
          ? uniqueStrings(entry.supportedModelFamilies)
          : resolveSkillModelFamilies(entry.structureType),
        materialFamilies: normalizeDomainMaterialFamilies(entry.materialFamilies as MaterialFamily[]),
        priority: entry.priority ?? 0,
        compatibility: {
          minRuntimeVersion: entry.compatibility.minRuntimeVersion,
          skillApiVersion: entry.compatibility.skillApiVersion,
        },
        autoLoadByDefault: entry.autoLoadByDefault,
        stages: uniqueStrings(entry.stages),
        name: {
          zh: entry.name?.zh,
          en: entry.name?.en,
        },
      };
    });
    const tools: CapabilityTool[] = Array.from(toolById.values()).sort((a, b) => a.id.localeCompare(b.id));
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

    let rawEngines: Record<string, unknown>[] = [];
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
        autoLoadSkillIds: [],
        capabilities: [],
      }]),
    );
    for (const skill of skills) {
      const existing = domainSummaryMap.get(skill.domain);
      if (!existing) {
        continue;
      }
      existing.skillIds.push(skill.id);
      if (skill.autoLoadByDefault) {
        existing.autoLoadSkillIds.push(skill.id);
      }
      existing.capabilities = Array.from(new Set([...existing.capabilities, ...skill.capabilities]));
    }

    const domainSummaries = [...domainSummaryMap.values()]
      .map((summary) => ({
        ...summary,
        skillIds: [...summary.skillIds].sort(),
        autoLoadSkillIds: [...summary.autoLoadSkillIds].sort(),
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
      foundationToolIds: [...FOUNDATION_TOOL_IDS],
      enabledToolIdsBySkill,
      providedToolIdsBySkill,
      skillIdsByToolId,
      skillAliasesByCanonicalId,
      canonicalSkillIdByAlias,
      analysisCompatibility,
      appliedAnalysisType: options?.analysisType,
    };
  }
}

export default AgentCapabilityService;
