import { AnalysisEngineCatalogService } from './analysis-engine.js';
import { AgentSkillRuntime } from './agent-skills/index.js';
import type { SkillDomain, SkillManifest } from './agent-skills/types.js';

interface CapabilitySkill {
  id: string;
  structureType?: string;
  domain: SkillDomain;
  requires: string[];
  conflicts: string[];
  capabilities: string[];
  priority: number;
  compatibility: {
    minCoreVersion: string;
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
    const skills: CapabilitySkill[] = manifests.map((manifest: SkillManifest) => ({
      id: manifest.id,
      structureType: manifest.structureType,
      domain: manifest.domain,
      requires: Array.isArray(manifest.requires) ? manifest.requires : [],
      conflicts: Array.isArray(manifest.conflicts) ? manifest.conflicts : [],
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
      priority: manifest.priority,
      compatibility: {
        minCoreVersion: manifest.compatibility?.minCoreVersion || '0.1.0',
        skillApiVersion: manifest.compatibility?.skillApiVersion || 'v1',
      },
      autoLoadByDefault: Boolean(manifest.autoLoadByDefault),
      stages: Array.isArray(manifest.stages) ? manifest.stages : [],
      name: {
        zh: manifest.name?.zh,
        en: manifest.name?.en,
      },
    }));

    const enginePayload = await this.engineCatalog.listEngines();
    const rawEngines = Array.isArray(enginePayload?.engines) ? enginePayload.engines as Array<Record<string, unknown>> : [];
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

    return {
      generatedAt: new Date().toISOString(),
      skills,
      engines,
      domainSummaries,
      validEngineIdsBySkill,
      filteredEngineReasonsBySkill,
      validSkillIdsByEngine,
      skillDomainById,
      appliedAnalysisType: options?.analysisType,
    };
  }
}

export default AgentCapabilityService;
