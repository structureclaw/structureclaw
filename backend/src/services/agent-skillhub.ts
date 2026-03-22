import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { normalizeSkillHubCatalogEntryToSkillPackage } from '../agent-skills/shared/package.js';
import type { SkillDomain } from '../agent-skills/runtime/types.js';

type SkillCompatibilityReasonCode = 'runtime_version_incompatible' | 'skill_api_version_incompatible';
type SkillIntegrityReasonCode = 'signature_invalid' | 'checksum_mismatch';

export interface SkillHubCatalogEntry {
  id: string;
  version: string;
  domain: SkillDomain;
  entrypoints?: {
    [key: string]: string | undefined;
  };
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
    minRuntimeVersion: string;
    skillApiVersion: string;
  };
  integrity: {
    checksum: string;
    signature: string;
  };
}

interface SkillHubCacheEntry {
  id: string;
  version: string;
  domain: SkillDomain;
  entrypoints?: {
    [key: string]: string | undefined;
  };
  compatibility: {
    minRuntimeVersion: string;
    skillApiVersion: string;
  };
  integrity: {
    checksum: string;
    signature: string;
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

interface SkillHubCacheFile {
  skills: Record<string, SkillHubCacheEntry>;
}

interface SkillHubCatalogSeed {
  id: string;
  version: string;
  domain: SkillDomain;
  entrypoints?: {
    [key: string]: string | undefined;
  };
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
    minRuntimeVersion: string;
    skillApiVersion: string;
  };
  integrityOverride?: Partial<SkillHubCatalogEntry['integrity']>;
}

function computeChecksum(id: string, version: string): string {
  return createHash('sha256').update(`${id}@${version}`, 'utf-8').digest('hex');
}

function computeSignature(id: string, version: string): string {
  return `sig:${id}:${version}`;
}

function buildCatalogEntry(seed: SkillHubCatalogSeed): SkillHubCatalogEntry {
  return {
    id: seed.id,
    version: seed.version,
    domain: seed.domain,
    entrypoints: seed.entrypoints,
    name: seed.name,
    description: seed.description,
    capabilities: seed.capabilities,
    compatibility: seed.compatibility,
    integrity: {
      checksum: seed.integrityOverride?.checksum ?? computeChecksum(seed.id, seed.version),
      signature: seed.integrityOverride?.signature ?? computeSignature(seed.id, seed.version),
    },
  };
}

const DEFAULT_CATALOG: SkillHubCatalogEntry[] = [
  buildCatalogEntry({
    id: 'skillhub.steel-connection-check',
    version: '1.0.0',
    domain: 'code-check',
    entrypoints: {
      codeCheck: 'dist/code-check.js',
    },
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
      minRuntimeVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
  }),
  buildCatalogEntry({
    id: 'skillhub.modal-report-pack',
    version: '1.0.0',
    domain: 'report-export',
    entrypoints: {
      reportExport: 'dist/report-export.js',
    },
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
      minRuntimeVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
  }),
  buildCatalogEntry({
    id: 'skillhub.seismic-simplified-policy',
    version: '1.0.0',
    domain: 'analysis-strategy',
    entrypoints: {
      analysisStrategy: 'dist/analysis-strategy.js',
    },
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
      minRuntimeVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
  }),
  buildCatalogEntry({
    id: 'skillhub.future-runtime-only',
    version: '1.0.0',
    domain: 'analysis-strategy',
    entrypoints: {
      analysisStrategy: 'dist/analysis-strategy.js',
    },
    name: {
      zh: '未来运行时策略包',
      en: 'Future Runtime Strategy Pack',
    },
    description: {
      zh: '需要更高运行时版本的实验性策略包。',
      en: 'Experimental policy pack requiring a newer runtime version.',
    },
    capabilities: ['analysis-policy'],
    compatibility: {
      minRuntimeVersion: '9.0.0',
      skillApiVersion: 'v2',
    },
  }),
  buildCatalogEntry({
    id: 'skillhub.bad-signature-pack',
    version: '1.0.0',
    domain: 'report-export',
    entrypoints: {
      reportExport: 'dist/report-export.js',
    },
    name: {
      zh: '签名异常报告包',
      en: 'Bad Signature Report Pack',
    },
    description: {
      zh: '用于验证签名失败处理路径。',
      en: 'Used to validate signature failure handling.',
    },
    capabilities: ['report-narrative'],
    compatibility: {
      minRuntimeVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
    integrityOverride: {
      signature: 'invalid-signature',
    },
  }),
  buildCatalogEntry({
    id: 'skillhub.bad-checksum-pack',
    version: '1.0.0',
    domain: 'report-export',
    entrypoints: {
      reportExport: 'dist/report-export.js',
    },
    name: {
      zh: '校验和异常报告包',
      en: 'Bad Checksum Report Pack',
    },
    description: {
      zh: '用于验证 checksum 失败处理路径。',
      en: 'Used to validate checksum failure handling.',
    },
    capabilities: ['report-export'],
    compatibility: {
      minRuntimeVersion: '0.1.0',
      skillApiVersion: 'v1',
    },
    integrityOverride: {
      checksum: 'bad-checksum',
    },
  }),
];

const CURRENT_RUNTIME_VERSION = process.env.SCLAW_RUNTIME_VERSION || '0.1.0';
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
  private readonly cacheFilePath: string;

  constructor(stateFilePath = path.resolve(process.cwd(), '.runtime/skillhub/installed.json')) {
    this.stateFilePath = stateFilePath;
    this.cacheFilePath = path.resolve(process.cwd(), '.runtime/skillhub/cache.json');
  }

  async search(options?: { keyword?: string; domain?: SkillDomain }) {
    this.assertRepositoryAvailable();
    const installed = await this.readInstalledState();
    const keyword = normalizeKeyword(options?.keyword);
    const filtered = DEFAULT_CATALOG
      .filter((entry) => !options?.domain || entry.domain === options.domain)
      .filter((entry) => matchesKeyword(entry, keyword));

    return {
      items: filtered.map((entry) => ({
        ...entry,
        packageMetadata: normalizeSkillHubCatalogEntryToSkillPackage(entry),
        compatibility: this.evaluateCompatibility(entry),
        integrity: this.evaluateIntegrity(entry),
        installed: Boolean(installed.skills[entry.id]),
        enabled: Boolean(installed.skills[entry.id]?.enabled),
      })),
      total: filtered.length,
    };
  }

  async listInstalled() {
    this.assertRepositoryAvailable();
    const installed = await this.readInstalledState();
    return Object.values(installed.skills).sort((a, b) => a.id.localeCompare(b.id));
  }

  async install(skillId: string) {
    this.assertRepositoryAvailable();
    let catalogSkill = DEFAULT_CATALOG.find((entry) => entry.id === skillId);
    let reusedFromCache = false;

    if (!catalogSkill && this.isOfflineModeEnabled()) {
      const cache = await this.readCacheState();
      const cached = cache.skills[skillId];
      if (cached) {
        catalogSkill = {
          ...cached,
          name: {
            zh: cached.id,
            en: cached.id,
          },
          description: {
            zh: 'cached skill package',
            en: 'cached skill package',
          },
          capabilities: [],
        };
        reusedFromCache = true;
      }
    }

    if (!catalogSkill) {
      throw new Error(`Skill not found in SkillHub catalog/cache: ${skillId}`);
    }

    const integrity = this.evaluateIntegrity(catalogSkill);
    if (!integrity.valid) {
      return {
        skillId,
        installed: false,
        alreadyInstalled: false,
        enabled: false,
        integrityStatus: 'rejected' as const,
        integrityReasonCodes: integrity.reasonCodes,
        fallbackBehavior: 'baseline_only' as const,
        reusedFromCache,
      };
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
        integrityStatus: 'verified' as const,
        integrityReasonCodes: [] as SkillIntegrityReasonCode[],
        fallbackBehavior: existing.compatibilityStatus === 'incompatible' ? 'baseline_only' : 'none',
        reusedFromCache,
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
    await this.upsertCacheState(catalogSkill);

    return {
      skillId,
      installed: true,
      alreadyInstalled: false,
      enabled: shouldEnable,
      compatibilityStatus: compatibility.compatible ? 'compatible' : 'incompatible',
      incompatibilityReasons: compatibility.reasonCodes,
      integrityStatus: 'verified' as const,
      integrityReasonCodes: [] as SkillIntegrityReasonCode[],
      fallbackBehavior: compatibility.compatible ? 'none' : 'baseline_only',
      reusedFromCache,
    };
  }

  async enable(skillId: string) {
    this.assertRepositoryAvailable();
    return this.updateEnabledState(skillId, true);
  }

  async disable(skillId: string) {
    this.assertRepositoryAvailable();
    return this.updateEnabledState(skillId, false);
  }

  async uninstall(skillId: string) {
    this.assertRepositoryAvailable();
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
        integrityStatus: 'verified' as const,
        integrityReasonCodes: [] as SkillIntegrityReasonCode[],
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
      integrityStatus: 'verified' as const,
      integrityReasonCodes: [] as SkillIntegrityReasonCode[],
      fallbackBehavior: compatibility.compatible ? 'none' : 'baseline_only',
    };
  }

  private evaluateIntegrity(entry: SkillHubCatalogEntry): {
    valid: boolean;
    reasonCodes: SkillIntegrityReasonCode[];
  } {
    const reasonCodes: SkillIntegrityReasonCode[] = [];
    const expectedChecksum = computeChecksum(entry.id, entry.version);
    const expectedSignature = computeSignature(entry.id, entry.version);
    if (entry.integrity.checksum !== expectedChecksum) {
      reasonCodes.push('checksum_mismatch');
    }
    if (entry.integrity.signature !== expectedSignature) {
      reasonCodes.push('signature_invalid');
    }
    return {
      valid: reasonCodes.length === 0,
      reasonCodes,
    };
  }

  private evaluateCompatibility(entry: SkillHubCatalogEntry): {
    compatible: boolean;
    reasonCodes: SkillCompatibilityReasonCode[];
  } {
    const reasonCodes: SkillCompatibilityReasonCode[] = [];
    if (isVersionGreater(entry.compatibility.minRuntimeVersion, CURRENT_RUNTIME_VERSION)) {
      reasonCodes.push('runtime_version_incompatible');
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

  private async readCacheState(): Promise<SkillHubCacheFile> {
    if (!existsSync(this.cacheFilePath)) {
      return { skills: {} };
    }

    try {
      const raw = await readFile(this.cacheFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as SkillHubCacheFile;
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

  private async upsertCacheState(entry: SkillHubCatalogEntry): Promise<void> {
    const current = await this.readCacheState();
    current.skills[entry.id] = {
      id: entry.id,
      version: entry.version,
      domain: entry.domain,
      compatibility: entry.compatibility,
      integrity: entry.integrity,
    };
    await mkdir(path.dirname(this.cacheFilePath), { recursive: true });
    await writeFile(this.cacheFilePath, JSON.stringify(current, null, 2), 'utf-8');
  }

  private async writeInstalledState(state: InstalledStateFile): Promise<void> {
    await mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private isOfflineModeEnabled(): boolean {
    const raw = process.env.SCLAW_SKILLHUB_OFFLINE;
    return raw === '1' || raw === 'true';
  }

  private assertRepositoryAvailable(): void {
    const raw = process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    if (raw === '1' || raw === 'true') {
      throw new Error('SKILLHUB_REPOSITORY_UNAVAILABLE');
    }
  }
}

export default AgentSkillHubService;
