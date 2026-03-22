import { AnalysisEngineCatalogService } from './analysis-engine.js';
import { AgentSkillRuntime } from '../agent-skills/runtime/index.js';
import { normalizeAnalysisTypes as normalizeDomainAnalysisTypes } from '../agent-skills/analysis-strategy/entry.js';
import { normalizeMaterialFamilies as normalizeDomainMaterialFamilies } from '../agent-skills/material-constitutive/entry.js';
import { normalizeBuiltInManifestToSkillPackage } from '../agent-skills/shared/package.js';
import type { AgentAnalysisType, SkillDomain, SkillManifest } from '../agent-skills/runtime/types.js';

interface CapabilitySkill {
  id: string;
  structureType?: string;
  domain: SkillDomain;
  requires: string[];
  conflicts: string[];
  capabilities: string[];
  supportedAnalysisTypes: AgentAnalysisType[];
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
  skillIds: string[];
  autoLoadSkillIds: string[];
  capabilities: string[];
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
    const skills: CapabilitySkill[] = manifests.map((manifest: SkillManifest) => {
      const pkg = normalizeBuiltInManifestToSkillPackage(manifest);
      return {
        id: pkg.id,
        structureType: manifest.structureType,
        domain: pkg.domain,
        requires: Array.isArray(pkg.requires) ? pkg.requires : [],
        conflicts: Array.isArray(pkg.conflicts) ? pkg.conflicts : [],
        capabilities: Array.isArray(pkg.capabilities) ? pkg.capabilities : [],
        supportedAnalysisTypes: normalizeDomainAnalysisTypes(pkg.supportedAnalysisTypes),
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
      const requiredFamilies = new Set(resolveSkillModelFamilies(skill.structureType));
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
          const requiredFamilies = resolveSkillModelFamilies(skill.structureType);
          return requiredFamilies.some((family) => familySet.has(family));
        })
        .map((skill) => skill.id);
    }

    const domainSummaryMap = new Map<SkillDomain, DomainSummary>();
    for (const skill of skills) {
      const existing = domainSummaryMap.get(skill.domain);
      if (!existing) {
        domainSummaryMap.set(skill.domain, {
          domain: skill.domain,
          skillIds: [skill.id],
          autoLoadSkillIds: skill.autoLoadByDefault ? [skill.id] : [],
          capabilities: [...skill.capabilities],
        });
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

    const analysisStrategySkills = skills.filter((skill) => skill.domain === 'analysis-strategy');
    const analysisStrategyCompatibility = ANALYSIS_TYPES.reduce<Record<CapabilityAnalysisType, {
      strategySkillIds: string[];
      compatibleEngineIds: string[];
      baselinePolicyAvailable: boolean;
    }>>((acc, analysisType) => {
      const strategySkillIds = analysisStrategySkills
        .filter((skill) => skill.supportedAnalysisTypes.length === 0 || skill.supportedAnalysisTypes.includes(analysisType))
        .map((skill) => skill.id)
        .sort();
      const compatibleEngineIds = engines
        .filter((engine) => engine.enabled && engine.available && engine.supportedAnalysisTypes.includes(analysisType))
        .map((engine) => engine.id)
        .sort();

      acc[analysisType] = {
        strategySkillIds,
        compatibleEngineIds,
        baselinePolicyAvailable: true,
      };
      return acc;
    }, {
      static: { strategySkillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
      dynamic: { strategySkillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
      seismic: { strategySkillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
      nonlinear: { strategySkillIds: [], compatibleEngineIds: [], baselinePolicyAvailable: true },
    });

    return {
      generatedAt: new Date().toISOString(),
      skills,
      engines,
      domainSummaries,
      validEngineIdsBySkill,
      filteredEngineReasonsBySkill,
      validSkillIdsByEngine,
      skillDomainById,
      analysisStrategyCompatibility,
      appliedAnalysisType: options?.analysisType,
    };
  }
}

export default AgentCapabilityService;
