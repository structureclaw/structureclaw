import { AnalysisEngineCatalogService } from './analysis-engine.js';
import { AgentSkillRuntime } from '../agent-runtime/index.js';
import { normalizeAnalysisTypes as normalizeDomainAnalysisTypes } from '../agent-skills/design/entry.js';
import { normalizeMaterialFamilies as normalizeDomainMaterialFamilies } from '../agent-skills/material/entry.js';
import { normalizeBuiltInManifestToSkillPackage } from '../skill-shared/package.js';
import { ALL_SKILL_DOMAINS } from '../agent-runtime/types.js';
import type { AgentAnalysisType, SkillDomain, SkillManifest, SkillRuntimeStatus, ToolManifest } from '../agent-runtime/types.js';

const ACTIVE_RUNTIME_DOMAINS = new Set<SkillDomain>(['structure-type', 'analysis', 'code-check']);
const PARTIAL_RUNTIME_DOMAINS = new Set<SkillDomain>(['validation', 'report-export']);

function resolveDomainRuntimeStatus(domain: SkillDomain): SkillRuntimeStatus {
  if (ACTIVE_RUNTIME_DOMAINS.has(domain)) {
    return 'active';
  }
  if (PARTIAL_RUNTIME_DOMAINS.has(domain)) {
    return 'partial';
  }
  return 'discoverable';
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
    private readonly engineCatalog = new AnalysisEngineCatalogService(),
  ) {}

  async getCapabilityMatrix(options?: { analysisType?: CapabilityAnalysisType }) {
    const manifests = await this.skillRuntime.listSkillManifests();
    const tooling = await this.skillRuntime.resolveSkillTooling(manifests.map((manifest) => manifest.id));
    const builtinTools = this.skillRuntime.listBuiltinToolManifests();
    const toolById = new Map<string, CapabilityTool>();

    for (const tool of builtinTools) {
      toolById.set(tool.id, {
        id: tool.id,
        source: tool.source,
        category: tool.category,
        enabledByDefault: tool.enabledByDefault,
        providedBySkillId: tool.providedBySkillId,
        requiresSkills: Array.isArray(tool.requiresSkills) ? [...tool.requiresSkills] : [],
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
      });
    }

    for (const tool of tooling.tools) {
      toolById.set(tool.id, {
        id: tool.id,
        source: tool.source,
        category: tool.category,
        enabledByDefault: tool.enabledByDefault,
        providedBySkillId: tool.providedBySkillId,
        requiresSkills: Array.isArray(tool.requiresSkills) ? [...tool.requiresSkills] : [],
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
      });
    }

    const structuralAndGeneralSkills: CapabilitySkill[] = manifests.map((manifest: SkillManifest) => {
      const pkg = normalizeBuiltInManifestToSkillPackage(manifest);
      return {
        id: pkg.id,
        structureType: manifest.structureType,
        domain: pkg.domain,
        runtimeStatus: resolveDomainRuntimeStatus(pkg.domain),
        requires: Array.isArray(pkg.requires) ? pkg.requires : [],
        conflicts: Array.isArray(pkg.conflicts) ? pkg.conflicts : [],
        capabilities: Array.isArray(pkg.capabilities) ? pkg.capabilities : [],
        supportedAnalysisTypes: normalizeDomainAnalysisTypes(pkg.supportedAnalysisTypes),
        supportedModelFamilies: Array.isArray(manifest.supportedModelFamilies) && manifest.supportedModelFamilies.length > 0
          ? [...manifest.supportedModelFamilies]
          : resolveSkillModelFamilies(manifest.structureType),
        materialFamilies: normalizeDomainMaterialFamilies(pkg.materialFamilies),
        priority: pkg.priority ?? 0,
        compatibility: {
          minRuntimeVersion: pkg.compatibility.minRuntimeVersion,
          skillApiVersion: pkg.compatibility.skillApiVersion,
        },
        autoLoadByDefault: pkg.enabledByDefault,
        stages: Array.isArray(manifest.stages) ? manifest.stages : [],
        name: {
          zh: pkg.name?.zh,
          en: pkg.name?.en,
        },
      };
    });
    const skills: CapabilitySkill[] = structuralAndGeneralSkills;
    const tools: CapabilityTool[] = Array.from(toolById.values()).sort((a, b) => a.id.localeCompare(b.id));

    const enginePayload = await this.engineCatalog.listEngines();
    const rawEngines = Array.isArray(enginePayload?.engines) ? enginePayload.engines.map((engine) => engine as unknown as Record<string, unknown>) : [];
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
        runtimeStatus: resolveDomainRuntimeStatus(domain),
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
      enabledToolIdsBySkill: tooling.enabledToolIdsBySkill,
      providedToolIdsBySkill: tooling.providedToolIdsBySkill,
      skillIdsByToolId: tooling.skillIdsByToolId,
      analysisCompatibility,
      appliedAnalysisType: options?.analysisType,
    };
  }
}

export default AgentCapabilityService;
