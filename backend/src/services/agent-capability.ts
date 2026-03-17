import { AnalysisEngineCatalogService } from './analysis-engine.js';
import { AgentSkillRuntime } from './agent-skills/index.js';

interface CapabilitySkill {
  id: string;
  structureType?: string;
  autoLoadByDefault: boolean;
  stages: string[];
  name: {
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

function isEngineOperable(engine: Record<string, unknown>): boolean {
  const enabled = engine.enabled !== false;
  const available = engine.available !== false;
  const status = typeof engine.status === 'string' ? engine.status : '';
  return enabled && available && status !== 'disabled' && status !== 'unavailable';
}

export class AgentCapabilityService {
  constructor(
    private readonly skillRuntime = new AgentSkillRuntime(),
    private readonly engineCatalog = new AnalysisEngineCatalogService(),
  ) {}

  async getCapabilityMatrix() {
    const skills: CapabilitySkill[] = this.skillRuntime.listSkills().map((skill) => ({
      id: skill.id,
      structureType: skill.structureType,
      autoLoadByDefault: Boolean(skill.autoLoadByDefault),
      stages: Array.isArray(skill.stages) ? skill.stages : [],
      name: {
        zh: skill.name?.zh,
        en: skill.name?.en,
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
    for (const skill of skills) {
      const requiredFamilies = new Set(resolveSkillModelFamilies(skill.structureType));
      validEngineIdsBySkill[skill.id] = engines
        .filter((engine) => isEngineOperable(engine as unknown as Record<string, unknown>))
        .filter((engine) => engine.supportedModelFamilies.some((family) => requiredFamilies.has(family)))
        .map((engine) => engine.id);
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

    return {
      generatedAt: new Date().toISOString(),
      skills,
      engines,
      validEngineIdsBySkill,
      validSkillIdsByEngine,
    };
  }
}

export default AgentCapabilityService;
