import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { SkillDomain } from './agent-skills/types.js';

type SkillCompatibilityReasonCode = 'core_version_incompatible' | 'skill_api_version_incompatible';

export interface SkillHubCatalogEntry {
  id: string;
  version: string;
  domain: SkillDomain;
  name: {
    zh: string;
    en: string;
  };
  description: {
    zh: string;
    en: string;
  };
  capabilities: string[];
  compatibility: {
    minCoreVersion: string;
    skillApiVersion: string;
  };
}

interface InstalledSkillRecord {
  id: string;
  version: string;
  enabled: boolean;
  installedAt: string;
  source: 'skillhub';
  compatibilityStatus: 'compatible' | 'incompatible';
  incompatibilityReasons: SkillCompatibilityReasonCode[];
}

interface InstalledStateFile {
  skills: Record<string, InstalledSkillRecord>;
}

const DEFAULT_CATALOG: SkillHubCatalogEntry[] = [
  {
    id: 'skillhub.steel-connection-check',
    version: '1.0.0',
    domain: 'code-check',
    name: {
      zh: '钢连接节点校核',
      en: 'Steel Connection Check',
    },
    description: {
      zh: '扩展钢结构连接节点验算能力。',
      en: 'Extends steel connection checking capabilities.',
    },
    capabilities: ['code-check', 'traceability'],
    compatibility: {
      minCoreVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
  },
  {
    id: 'skillhub.modal-report-pack',
    version: '1.0.0',
    domain: 'report-export',
    name: {
      zh: '模态分析报告包',
      en: 'Modal Report Pack',
    },
    description: {
      zh: '提供动力/模态分析结果摘要模板。',
      en: 'Adds report templates for dynamic and modal analysis.',
    },
    capabilities: ['report-narrative', 'report-export'],
    compatibility: {
      minCoreVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
  },
  {
    id: 'skillhub.seismic-simplified-policy',
    version: '1.0.0',
    domain: 'analysis-strategy',
    name: {
      zh: '抗震简化策略',
      en: 'Seismic Simplified Policy',
    },
    description: {
      zh: '提供轻量抗震策略推荐与参数建议。',
      en: 'Provides lightweight seismic policy suggestions.',
    },
    capabilities: ['analysis-policy', 'interaction-questions'],
    compatibility: {
      minCoreVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
  },
  {
    id: 'skillhub.future-core-only',
    version: '1.0.0',
    domain: 'analysis-strategy',
    name: {
      zh: '未来核心策略包',
      en: 'Future Core Strategy Pack',
    },
    description: {
      zh: '需要更高核心版本的实验性策略包。',
      en: 'Experimental policy pack requiring a newer core version.',
    },
    capabilities: ['analysis-policy'],
    compatibility: {
      minCoreVersion: '9.0.0',
      skillApiVersion: 'v2',
    },
  },
];

const CURRENT_CORE_VERSION = process.env.SCLAW_CORE_VERSION || '0.1.0';
const CURRENT_SKILL_API_VERSION = process.env.SCLAW_SKILL_API_VERSION || 'v1';

function parseVersion(value: string): number[] {
  return String(value)
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function isVersionGreater(required: string, current: string): boolean {
  const requiredParts = parseVersion(required);
  const currentParts = parseVersion(current);
  const maxLen = Math.max(requiredParts.length, currentParts.length);
  for (let index = 0; index < maxLen; index += 1) {
    const left = requiredParts[index] || 0;
    const right = currentParts[index] || 0;
    if (left === right) {
      continue;
    }
    return left > right;
  }
  return false;
}

function normalizeKeyword(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchesKeyword(entry: SkillHubCatalogEntry, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  const haystacks = [
    entry.id,
    entry.name.zh,
    entry.name.en,
    entry.description.zh,
    entry.description.en,
    ...entry.capabilities,
  ].map((item) => item.toLowerCase());
  return haystacks.some((item) => item.includes(keyword));
}

export class AgentSkillHubService {
  private readonly stateFilePath: string;

  constructor(stateFilePath = path.resolve(process.cwd(), '.runtime/skillhub/installed.json')) {
    this.stateFilePath = stateFilePath;
  }

  async search(options?: { keyword?: string; domain?: SkillDomain }) {
    const installed = await this.readInstalledState();
    const keyword = normalizeKeyword(options?.keyword);
    const filtered = DEFAULT_CATALOG
      .filter((entry) => !options?.domain || entry.domain === options.domain)
      .filter((entry) => matchesKeyword(entry, keyword));

    return {
      items: filtered.map((entry) => ({
        ...entry,
        compatibility: this.evaluateCompatibility(entry),
        installed: Boolean(installed.skills[entry.id]),
        enabled: Boolean(installed.skills[entry.id]?.enabled),
      })),
      total: filtered.length,
    };
  }

  async listInstalled() {
    const installed = await this.readInstalledState();
    return Object.values(installed.skills).sort((a, b) => a.id.localeCompare(b.id));
  }

  async install(skillId: string) {
    const catalogSkill = DEFAULT_CATALOG.find((entry) => entry.id === skillId);
    if (!catalogSkill) {
      throw new Error(`Skill not found in SkillHub catalog: ${skillId}`);
    }

    const state = await this.readInstalledState();
    const existing = state.skills[skillId];
    if (existing) {
      return {
        skillId,
        installed: true,
        alreadyInstalled: true,
        enabled: existing.enabled,
        compatibilityStatus: existing.compatibilityStatus,
        incompatibilityReasons: existing.incompatibilityReasons,
        fallbackBehavior: existing.compatibilityStatus === 'incompatible' ? 'baseline_only' : 'none',
      };
    }

    const compatibility = this.evaluateCompatibility(catalogSkill);
    const shouldEnable = compatibility.compatible;

    state.skills[skillId] = {
      id: catalogSkill.id,
      version: catalogSkill.version,
      enabled: shouldEnable,
      installedAt: new Date().toISOString(),
      source: 'skillhub',
      compatibilityStatus: compatibility.compatible ? 'compatible' : 'incompatible',
      incompatibilityReasons: compatibility.reasonCodes,
    };
    await this.writeInstalledState(state);

    return {
      skillId,
      installed: true,
      alreadyInstalled: false,
      enabled: shouldEnable,
      compatibilityStatus: compatibility.compatible ? 'compatible' : 'incompatible',
      incompatibilityReasons: compatibility.reasonCodes,
      fallbackBehavior: compatibility.compatible ? 'none' : 'baseline_only',
    };
  }

  async enable(skillId: string) {
    return this.updateEnabledState(skillId, true);
  }

  async disable(skillId: string) {
    return this.updateEnabledState(skillId, false);
  }

  async uninstall(skillId: string) {
    const state = await this.readInstalledState();
    const existing = state.skills[skillId];
    if (!existing) {
      return {
        skillId,
        uninstalled: false,
        existed: false,
      };
    }

    delete state.skills[skillId];
    await this.writeInstalledState(state);

    return {
      skillId,
      uninstalled: true,
      existed: true,
    };
  }

  private async updateEnabledState(skillId: string, enabled: boolean) {
    const state = await this.readInstalledState();
    const existing = state.skills[skillId];
    if (!existing) {
      throw new Error(`Skill is not installed: ${skillId}`);
    }

    const catalogSkill = DEFAULT_CATALOG.find((entry) => entry.id === skillId);
    if (!catalogSkill) {
      throw new Error(`Skill not found in SkillHub catalog: ${skillId}`);
    }

    const compatibility = this.evaluateCompatibility(catalogSkill);
    if (!compatibility.compatible && enabled) {
      existing.enabled = false;
      existing.compatibilityStatus = 'incompatible';
      existing.incompatibilityReasons = compatibility.reasonCodes;
      await this.writeInstalledState(state);
      return {
        skillId,
        enabled: false,
        compatibilityStatus: 'incompatible' as const,
        incompatibilityReasons: compatibility.reasonCodes,
        fallbackBehavior: 'baseline_only' as const,
      };
    }

    existing.enabled = enabled;
    existing.compatibilityStatus = compatibility.compatible ? 'compatible' : 'incompatible';
    existing.incompatibilityReasons = compatibility.reasonCodes;
    await this.writeInstalledState(state);

    return {
      skillId,
      enabled,
      compatibilityStatus: compatibility.compatible ? 'compatible' : 'incompatible',
      incompatibilityReasons: compatibility.reasonCodes,
      fallbackBehavior: compatibility.compatible ? 'none' : 'baseline_only',
    };
  }

  private evaluateCompatibility(entry: SkillHubCatalogEntry): {
    compatible: boolean;
    reasonCodes: SkillCompatibilityReasonCode[];
  } {
    const reasonCodes: SkillCompatibilityReasonCode[] = [];
    if (isVersionGreater(entry.compatibility.minCoreVersion, CURRENT_CORE_VERSION)) {
      reasonCodes.push('core_version_incompatible');
    }
    if (entry.compatibility.skillApiVersion !== CURRENT_SKILL_API_VERSION) {
      reasonCodes.push('skill_api_version_incompatible');
    }
    return {
      compatible: reasonCodes.length === 0,
      reasonCodes,
    };
  }

  private async readInstalledState(): Promise<InstalledStateFile> {
    if (!existsSync(this.stateFilePath)) {
      return { skills: {} };
    }

    try {
      const raw = await readFile(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as InstalledStateFile;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.skills !== 'object') {
        return { skills: {} };
      }
      return {
        skills: parsed.skills,
      };
    } catch {
      return { skills: {} };
    }
  }

  private async writeInstalledState(state: InstalledStateFile): Promise<void> {
    await mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}

export default AgentSkillHubService;
