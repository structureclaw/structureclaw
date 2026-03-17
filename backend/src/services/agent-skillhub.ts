import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { SkillDomain } from './agent-skills/types.js';

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
];

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
      };
    }

    state.skills[skillId] = {
      id: catalogSkill.id,
      version: catalogSkill.version,
      enabled: true,
      installedAt: new Date().toISOString(),
      source: 'skillhub',
    };
    await this.writeInstalledState(state);

    return {
      skillId,
      installed: true,
      alreadyInstalled: false,
      enabled: true,
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

    existing.enabled = enabled;
    await this.writeInstalledState(state);

    return {
      skillId,
      enabled,
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
