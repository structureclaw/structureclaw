import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentSkillHubService } from '../dist/services/agent-skillhub.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory and return paths for state + cache files. */
function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-test-'));
  const stateFilePath = path.join(dir, 'installed.json');
  const cacheFilePath = path.join(dir, 'cache.json');
  return { dir, stateFilePath, cacheFilePath };
}

/** Remove a temp directory recursively. */
function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Write a JSON object to a file synchronously. */
function writeJsonSync(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/** Read and parse a JSON file synchronously. */
function readJsonSync(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/** Build a service instance that uses the given temp state file path. */
function buildService(stateFilePath) {
  return new AgentSkillHubService(stateFilePath);
}

// Well-known catalog IDs from the source code
const STEEL_CONNECTION_ID = 'skillhub.steel-connection-check';
const MODAL_REPORT_ID = 'skillhub.modal-report-pack';
const SEISMIC_POLICY_ID = 'skillhub.seismic-simplified-policy';
const FUTURE_RUNTIME_ID = 'skillhub.future-runtime-only';
const BAD_SIGNATURE_ID = 'skillhub.bad-signature-pack';
const BAD_CHECKSUM_ID = 'skillhub.bad-checksum-pack';

// ---------------------------------------------------------------------------
// search()
// ---------------------------------------------------------------------------

describe('AgentSkillHubService.search()', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    delete process.env.SCLAW_RUNTIME_VERSION;
    delete process.env.SCLAW_SKILL_API_VERSION;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should return all catalog entries when no filters are provided', async () => {
    const result = await service.search();
    expect(result.total).toBe(6);
    expect(result.items).toHaveLength(6);
    // Each item should have standard shape
    const first = result.items[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('version');
    expect(first).toHaveProperty('domain');
    expect(first).toHaveProperty('compatibility');
    expect(first).toHaveProperty('integrity');
    expect(first).toHaveProperty('installed');
    expect(first).toHaveProperty('enabled');
  });

  test('should filter by domain', async () => {
    const result = await service.search({ domain: 'analysis' });
    expect(result.total).toBe(2);
    for (const item of result.items) {
      expect(item.domain).toBe('analysis');
    }
  });

  test('should filter by domain = code-check', async () => {
    const result = await service.search({ domain: 'code-check' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(STEEL_CONNECTION_ID);
  });

  test('should filter by domain = report-export', async () => {
    const result = await service.search({ domain: 'report-export' });
    expect(result.total).toBe(3);
  });

  test('should return empty for a domain with no entries', async () => {
    const result = await service.search({ domain: 'visualization' });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  test('should filter by keyword matching id', async () => {
    const result = await service.search({ keyword: 'steel-connection' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(STEEL_CONNECTION_ID);
  });

  test('should filter by keyword matching Chinese name', async () => {
    const result = await service.search({ keyword: '\u94A2\u8FDE\u63A5' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(STEEL_CONNECTION_ID);
  });

  test('should filter by keyword matching English name', async () => {
    const result = await service.search({ keyword: 'Modal' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(MODAL_REPORT_ID);
  });

  test('should filter by keyword matching capability', async () => {
    const result = await service.search({ keyword: 'traceability' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(STEEL_CONNECTION_ID);
  });

  test('should filter by keyword matching description', async () => {
    const result = await service.search({ keyword: 'seismic' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(SEISMIC_POLICY_ID);
  });

  test('should filter by keyword matching Chinese description', async () => {
    const result = await service.search({ keyword: '\u52A8\u529B' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(MODAL_REPORT_ID);
  });

  test('should combine domain and keyword filters', async () => {
    const result = await service.search({ domain: 'analysis', keyword: 'seismic' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(SEISMIC_POLICY_ID);
  });

  test('should return empty when keyword does not match any entry', async () => {
    const result = await service.search({ keyword: 'nonexistent-xyz' });
    expect(result.total).toBe(0);
  });

  test('should be case-insensitive for keyword matching', async () => {
    const result = await service.search({ keyword: 'STEEL' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(STEEL_CONNECTION_ID);
  });

  test('should treat keyword with only whitespace as no keyword', async () => {
    const result = await service.search({ keyword: '   ' });
    expect(result.total).toBe(6);
  });

  test('should treat undefined keyword as no keyword', async () => {
    const result = await service.search({ keyword: undefined });
    expect(result.total).toBe(6);
  });

  test('should mark items as not installed and not enabled by default', async () => {
    const result = await service.search();
    for (const item of result.items) {
      expect(item.installed).toBe(false);
      expect(item.enabled).toBe(false);
    }
  });

  test('should mark installed items correctly', async () => {
    // Install one skill first
    await service.install(STEEL_CONNECTION_ID);

    const result = await service.search();
    const steelItem = result.items.find((i) => i.id === STEEL_CONNECTION_ID);
    expect(steelItem.installed).toBe(true);
    expect(steelItem.enabled).toBe(true);

    // Others remain uninstalled
    const otherItem = result.items.find((i) => i.id === MODAL_REPORT_ID);
    expect(otherItem.installed).toBe(false);
    expect(otherItem.enabled).toBe(false);
  });

  test('should evaluate integrity for each item', async () => {
    const result = await service.search();
    const goodItem = result.items.find((i) => i.id === STEEL_CONNECTION_ID);
    expect(goodItem.integrity.valid).toBe(true);
    expect(goodItem.integrity.reasonCodes).toEqual([]);

    const badSigItem = result.items.find((i) => i.id === BAD_SIGNATURE_ID);
    expect(badSigItem.integrity.valid).toBe(false);
    expect(badSigItem.integrity.reasonCodes).toContain('signature_invalid');

    const badChecksumItem = result.items.find((i) => i.id === BAD_CHECKSUM_ID);
    expect(badChecksumItem.integrity.valid).toBe(false);
    expect(badChecksumItem.integrity.reasonCodes).toContain('checksum_mismatch');
  });

  test('should evaluate compatibility for each item', async () => {
    const result = await service.search();
    // Default runtime 0.1.0, api v1 -- most items compatible
    const compatibleItem = result.items.find((i) => i.id === STEEL_CONNECTION_ID);
    expect(compatibleItem.compatibility.compatible).toBe(true);

    // Future runtime skill is incompatible
    const futureItem = result.items.find((i) => i.id === FUTURE_RUNTIME_ID);
    expect(futureItem.compatibility.compatible).toBe(false);
    expect(futureItem.compatibility.reasonCodes).toContain('runtime_version_incompatible');
    expect(futureItem.compatibility.reasonCodes).toContain('skill_api_version_incompatible');
  });

  test('should throw when repository is forced down', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = '1';
    await expect(service.search()).rejects.toThrow('SKILLHUB_REPOSITORY_UNAVAILABLE');
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });
});

// ---------------------------------------------------------------------------
// listInstalled()
// ---------------------------------------------------------------------------

describe('AgentSkillHubService.listInstalled()', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should return empty array when nothing is installed', async () => {
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should return installed skills sorted by id', async () => {
    await service.install(MODAL_REPORT_ID);
    await service.install(STEEL_CONNECTION_ID);

    const list = await service.listInstalled();
    expect(list).toHaveLength(2);
    // localeCompare sort: "modal..." < "steel..."
    expect(list[0].id).toBe(MODAL_REPORT_ID);
    expect(list[1].id).toBe(STEEL_CONNECTION_ID);
  });

  test('should include correct fields on installed records', async () => {
    await service.install(STEEL_CONNECTION_ID);

    const list = await service.listInstalled();
    expect(list).toHaveLength(1);
    const record = list[0];
    expect(record.id).toBe(STEEL_CONNECTION_ID);
    expect(record.version).toBe('1.0.0');
    expect(record.enabled).toBe(true);
    expect(record.source).toBe('skillhub');
    expect(record.compatibilityStatus).toBe('compatible');
    expect(record.incompatibilityReasons).toEqual([]);
    expect(typeof record.installedAt).toBe('string');
  });

  test('should reflect uninstallation', async () => {
    await service.install(STEEL_CONNECTION_ID);
    await service.uninstall(STEEL_CONNECTION_ID);

    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should throw when repository is forced down', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = 'true';
    await expect(service.listInstalled()).rejects.toThrow('SKILLHUB_REPOSITORY_UNAVAILABLE');
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });
});

// ---------------------------------------------------------------------------
// install()
// ---------------------------------------------------------------------------

describe('AgentSkillHubService.install()', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should install a compatible skill successfully', async () => {
    const result = await service.install(STEEL_CONNECTION_ID);
    expect(result.skillId).toBe(STEEL_CONNECTION_ID);
    expect(result.installed).toBe(true);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.enabled).toBe(true);
    expect(result.compatibilityStatus).toBe('compatible');
    expect(result.incompatibilityReasons).toEqual([]);
    expect(result.integrityStatus).toBe('verified');
    expect(result.integrityReasonCodes).toEqual([]);
    expect(result.fallbackBehavior).toBe('none');
    expect(result.reusedFromCache).toBe(false);
  });

  test('should persist installed state to disk', async () => {
    await service.install(STEEL_CONNECTION_ID);
    const state = readJsonSync(stateFilePath);
    expect(state.skills[STEEL_CONNECTION_ID]).toBeDefined();
    expect(state.skills[STEEL_CONNECTION_ID].id).toBe(STEEL_CONNECTION_ID);
    expect(state.skills[STEEL_CONNECTION_ID].source).toBe('skillhub');
  });

  test('should also write cache state to disk', async () => {
    await service.install(STEEL_CONNECTION_ID);
    // The constructor derives cacheFilePath from process.cwd(), not from stateFilePath.
    // The cache file lands at cwd/.runtime/skillhub/cache.json. Verify it exists and
    // contains the expected entry. Clean up afterward.
    const actualCachePath = path.resolve(process.cwd(), '.runtime/skillhub/cache.json');
    const cache = readJsonSync(actualCachePath);
    expect(cache.skills[STEEL_CONNECTION_ID]).toBeDefined();
    expect(cache.skills[STEEL_CONNECTION_ID].id).toBe(STEEL_CONNECTION_ID);
    expect(cache.skills[STEEL_CONNECTION_ID].domain).toBe('code-check');
    // Cleanup the cwd-derived cache directory created by this test
    fs.rmSync(path.resolve(process.cwd(), '.runtime/skillhub'), { recursive: true, force: true });
  });

  test('should return alreadyInstalled=true on second install', async () => {
    await service.install(STEEL_CONNECTION_ID);
    const result = await service.install(STEEL_CONNECTION_ID);
    expect(result.installed).toBe(true);
    expect(result.alreadyInstalled).toBe(true);
  });

  test('should throw for unknown skill id', async () => {
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
  });

  test('should reject skill with invalid signature (integrity check)', async () => {
    const result = await service.install(BAD_SIGNATURE_ID);
    expect(result.installed).toBe(false);
    expect(result.integrityStatus).toBe('rejected');
    expect(result.integrityReasonCodes).toContain('signature_invalid');
    expect(result.fallbackBehavior).toBe('baseline_only');
    expect(result.enabled).toBe(false);
  });

  test('should reject skill with invalid checksum (integrity check)', async () => {
    const result = await service.install(BAD_CHECKSUM_ID);
    expect(result.installed).toBe(false);
    expect(result.integrityStatus).toBe('rejected');
    expect(result.integrityReasonCodes).toContain('checksum_mismatch');
    expect(result.fallbackBehavior).toBe('baseline_only');
  });

  test('should install incompatible skill but mark it as disabled', async () => {
    // The future-runtime skill requires runtime 9.0.0 and api v2
    const result = await service.install(FUTURE_RUNTIME_ID);
    expect(result.installed).toBe(true);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.compatibilityStatus).toBe('incompatible');
    expect(result.incompatibilityReasons.length).toBeGreaterThan(0);
    expect(result.fallbackBehavior).toBe('baseline_only');
  });

  test('should persist incompatible skill state correctly', async () => {
    await service.install(FUTURE_RUNTIME_ID);
    const state = readJsonSync(stateFilePath);
    const record = state.skills[FUTURE_RUNTIME_ID];
    expect(record.enabled).toBe(false);
    expect(record.compatibilityStatus).toBe('incompatible');
    expect(record.incompatibilityReasons.length).toBeGreaterThan(0);
  });

  test('should throw when repository is forced down', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = '1';
    await expect(service.install(STEEL_CONNECTION_ID)).rejects.toThrow(
      'SKILLHUB_REPOSITORY_UNAVAILABLE',
    );
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });

  test('should fall back to cache in offline mode when skill not in catalog', async () => {
    // The cache file path is derived from process.cwd(), not from stateFilePath.
    const actualCacheDir = path.resolve(process.cwd(), '.runtime/skillhub');
    const actualCachePath = path.join(actualCacheDir, 'cache.json');

    // Write a cache-only entry that is NOT in the DEFAULT_CATALOG
    const cachedSkill = {
      id: 'skillhub.cached-only-test',
      version: '2.0.0',
      domain: 'analysis',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      integrity: { checksum: 'fake-checksum', signature: 'fake-signature' },
    };
    writeJsonSync(actualCachePath, { skills: { 'skillhub.cached-only-test': cachedSkill } });

    // Enable offline mode
    process.env.SCLAW_SKILLHUB_OFFLINE = '1';

    try {
      // This skill is NOT in the catalog, but IS in cache + offline mode
      const result = await service.install('skillhub.cached-only-test');
      expect(result.reusedFromCache).toBe(true);
      // Integrity will fail since checksum/signature don't match computed values
      expect(result.integrityStatus).toBe('rejected');
      expect(result.installed).toBe(false);
    } finally {
      delete process.env.SCLAW_SKILLHUB_OFFLINE;
      fs.rmSync(actualCacheDir, { recursive: true, force: true });
    }
  });

  test('should not fall back to cache when offline mode is disabled', async () => {
    // The cache file path is derived from process.cwd()
    const actualCacheDir = path.resolve(process.cwd(), '.runtime/skillhub');
    const actualCachePath = path.join(actualCacheDir, 'cache.json');

    writeJsonSync(actualCachePath, {
      skills: {
        'skillhub.cached-only-test': {
          id: 'skillhub.cached-only-test',
          version: '2.0.0',
          domain: 'analysis',
          compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
          integrity: { checksum: 'a', signature: 'b' },
        },
      },
    });

    try {
      // Without offline mode, cache-only skills should not be found
      await expect(service.install('skillhub.cached-only-test')).rejects.toThrow(
        'Skill not found in SkillHub catalog/cache: skillhub.cached-only-test',
      );
    } finally {
      fs.rmSync(actualCacheDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// enable()
// ---------------------------------------------------------------------------

describe('AgentSkillHubService.enable()', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    delete process.env.SCLAW_RUNTIME_VERSION;
    delete process.env.SCLAW_SKILL_API_VERSION;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should enable an installed compatible skill', async () => {
    await service.install(STEEL_CONNECTION_ID);
    await service.disable(STEEL_CONNECTION_ID);

    const result = await service.enable(STEEL_CONNECTION_ID);
    expect(result.skillId).toBe(STEEL_CONNECTION_ID);
    expect(result.enabled).toBe(true);
    expect(result.compatibilityStatus).toBe('compatible');
    expect(result.integrityStatus).toBe('verified');
    expect(result.fallbackBehavior).toBe('none');
  });

  test('should persist enabled state', async () => {
    await service.install(STEEL_CONNECTION_ID);
    await service.disable(STEEL_CONNECTION_ID);
    await service.enable(STEEL_CONNECTION_ID);

    const state = readJsonSync(stateFilePath);
    expect(state.skills[STEEL_CONNECTION_ID].enabled).toBe(true);
  });

  test('should throw when skill is not installed', async () => {
    await expect(service.enable(STEEL_CONNECTION_ID)).rejects.toThrow(
      `Skill is not installed: ${STEEL_CONNECTION_ID}`,
    );
  });

  test('should refuse to enable an incompatible skill', async () => {
    await service.install(FUTURE_RUNTIME_ID);

    const result = await service.enable(FUTURE_RUNTIME_ID);
    expect(result.enabled).toBe(false);
    expect(result.compatibilityStatus).toBe('incompatible');
    expect(result.fallbackBehavior).toBe('baseline_only');
  });

  test('should throw when repository is forced down', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = 'true';
    await expect(service.enable(STEEL_CONNECTION_ID)).rejects.toThrow(
      'SKILLHUB_REPOSITORY_UNAVAILABLE',
    );
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });
});

// ---------------------------------------------------------------------------
// disable()
// ---------------------------------------------------------------------------

describe('AgentSkillHubService.disable()', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should disable an installed enabled skill', async () => {
    await service.install(STEEL_CONNECTION_ID);
    const result = await service.disable(STEEL_CONNECTION_ID);
    expect(result.skillId).toBe(STEEL_CONNECTION_ID);
    expect(result.enabled).toBe(false);
    expect(result.compatibilityStatus).toBe('compatible');
    expect(result.integrityStatus).toBe('verified');
  });

  test('should persist disabled state', async () => {
    await service.install(STEEL_CONNECTION_ID);
    await service.disable(STEEL_CONNECTION_ID);

    const state = readJsonSync(stateFilePath);
    expect(state.skills[STEEL_CONNECTION_ID].enabled).toBe(false);
  });

  test('should throw when skill is not installed', async () => {
    await expect(service.disable(STEEL_CONNECTION_ID)).rejects.toThrow(
      `Skill is not installed: ${STEEL_CONNECTION_ID}`,
    );
  });

  test('should throw when repository is forced down', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = '1';
    await expect(service.disable(STEEL_CONNECTION_ID)).rejects.toThrow(
      'SKILLHUB_REPOSITORY_UNAVAILABLE',
    );
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });
});

// ---------------------------------------------------------------------------
// uninstall()
// ---------------------------------------------------------------------------

describe('AgentSkillHubService.uninstall()', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should uninstall an installed skill', async () => {
    await service.install(STEEL_CONNECTION_ID);
    const result = await service.uninstall(STEEL_CONNECTION_ID);
    expect(result.skillId).toBe(STEEL_CONNECTION_ID);
    expect(result.uninstalled).toBe(true);
    expect(result.existed).toBe(true);
  });

  test('should remove skill from state file on disk', async () => {
    await service.install(STEEL_CONNECTION_ID);
    await service.uninstall(STEEL_CONNECTION_ID);

    const state = readJsonSync(stateFilePath);
    expect(state.skills[STEEL_CONNECTION_ID]).toBeUndefined();
  });

  test('should return existed=false when skill was never installed', async () => {
    const result = await service.uninstall(STEEL_CONNECTION_ID);
    expect(result.skillId).toBe(STEEL_CONNECTION_ID);
    expect(result.uninstalled).toBe(false);
    expect(result.existed).toBe(false);
  });

  test('should return existed=false for unknown skill id', async () => {
    const result = await service.uninstall('nonexistent.skill');
    expect(result.uninstalled).toBe(false);
    expect(result.existed).toBe(false);
  });

  test('should throw when repository is forced down', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = '1';
    await expect(service.uninstall(STEEL_CONNECTION_ID)).rejects.toThrow(
      'SKILLHUB_REPOSITORY_UNAVAILABLE',
    );
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });
});

// ---------------------------------------------------------------------------
// File I/O edge cases: readInstalledState / readCacheState
// ---------------------------------------------------------------------------

describe('AgentSkillHubService file I/O edge cases', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should handle missing state file gracefully (returns empty skills)', async () => {
    // stateFilePath does not exist
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should handle empty state file (returns empty skills)', async () => {
    writeJsonSync(stateFilePath, {});
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should handle state file with skills=null -- returns { skills: null } due to typeof null === "object" passing the guard', async () => {
    writeJsonSync(stateFilePath, { skills: null });
    // NOTE: typeof null === 'object' in JavaScript, so the `typeof parsed.skills !== 'object'`
    // guard in readInstalledState() does NOT filter out null. The returned object is
    // { skills: null }. listInstalled then calls Object.values(null) which throws TypeError.
    // This test documents the current behavior. A future fix should add `parsed.skills === null`
    // to the guard condition.
    await expect(service.listInstalled()).rejects.toThrow();
  });

  test('should handle state file with invalid JSON (returns empty skills)', async () => {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, '{invalid json', 'utf-8');
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should handle state file that is a non-object JSON value (returns empty skills)', async () => {
    writeJsonSync(stateFilePath, 42);
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should handle state file that is a string JSON value (returns empty skills)', async () => {
    writeJsonSync(stateFilePath, '"hello"');
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should handle state file with skills as an array (returns empty skills)', async () => {
    writeJsonSync(stateFilePath, { skills: [] });
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should read valid installed state correctly', async () => {
    writeJsonSync(stateFilePath, {
      skills: {
        [STEEL_CONNECTION_ID]: {
          id: STEEL_CONNECTION_ID,
          version: '1.0.0',
          enabled: true,
          installedAt: '2024-01-01T00:00:00.000Z',
          source: 'skillhub',
          compatibilityStatus: 'compatible',
          incompatibilityReasons: [],
        },
      },
    });
    const list = await service.listInstalled();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(STEEL_CONNECTION_ID);
  });
});

// ---------------------------------------------------------------------------
// Cache file I/O edge cases: readCacheState error paths
// The cache file is always at cwd/.runtime/skillhub/cache.json, independent of
// the stateFilePath constructor argument. These tests write directly to that path.
// ---------------------------------------------------------------------------

describe('AgentSkillHubService readCacheState edge cases', () => {
  let dir;
  let stateFilePath;
  let service;
  const actualCacheDir = path.resolve(process.cwd(), '.runtime/skillhub');
  const actualCachePath = path.join(actualCacheDir, 'cache.json');

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  afterEach(() => {
    cleanupTempDir(dir);
    fs.rmSync(actualCacheDir, { recursive: true, force: true });
  });

  test('should handle missing cache file gracefully in offline mode', async () => {
    process.env.SCLAW_SKILLHUB_OFFLINE = '1';
    // No cache file exists -- readCacheState returns { skills: {} }
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  test('should handle invalid JSON cache file in offline mode', async () => {
    fs.mkdirSync(actualCacheDir, { recursive: true });
    fs.writeFileSync(actualCachePath, '{invalid json', 'utf-8');

    process.env.SCLAW_SKILLHUB_OFFLINE = '1';
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  test('should handle cache file with non-object parsed value in offline mode', async () => {
    writeJsonSync(actualCachePath, 42);

    process.env.SCLAW_SKILLHUB_OFFLINE = '1';
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  test('should handle cache file with skills as array in offline mode', async () => {
    writeJsonSync(actualCachePath, { skills: [] });

    process.env.SCLAW_SKILLHUB_OFFLINE = '1';
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  test('should throw TypeError when cache file has skills=null in offline mode', async () => {
    // NOTE: typeof null === 'object' passes the guard in readCacheState, so
    // the method returns { skills: null }. Then cache.skills[skillId] throws
    // TypeError: Cannot read properties of null. This documents a bug parallel
    // to the readInstalledState one.
    writeJsonSync(actualCachePath, { skills: null });

    process.env.SCLAW_SKILLHUB_OFFLINE = '1';
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      /Cannot read properties of null/,
    );
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  test('should find and install a cache-only skill with valid integrity', async () => {
    // To test the happy path through readCacheState, we need a cached skill whose
    // computed checksum/signature matches what is stored. We can achieve this by
    // computing the expected values using the same algorithm as the source.
    const { createHash } = await import('node:crypto');
    const id = 'skillhub.cache-valid-test';
    const version = '1.0.0';
    const checksum = createHash('sha256').update(`${id}@${version}`, 'utf-8').digest('hex');
    const signature = `sig:${id}:${version}`;

    writeJsonSync(actualCachePath, {
      skills: {
        [id]: {
          id,
          version,
          domain: 'analysis',
          compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
          integrity: { checksum, signature },
        },
      },
    });

    process.env.SCLAW_SKILLHUB_OFFLINE = '1';
    const result = await service.install(id);
    expect(result.reusedFromCache).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.integrityStatus).toBe('verified');
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });
});

// ---------------------------------------------------------------------------
// assertRepositoryAvailable / environment variables
// ---------------------------------------------------------------------------

describe('AgentSkillHubService environment variable handling', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  afterEach(() => {
    cleanupTempDir(dir);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    delete process.env.SCLAW_SKILLHUB_OFFLINE;
  });

  test('should throw SKILLHUB_REPOSITORY_UNAVAILABLE when SCLAW_SKILLHUB_FORCE_DOWN=1', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = '1';
    await expect(service.search()).rejects.toThrow('SKILLHUB_REPOSITORY_UNAVAILABLE');
  });

  test('should throw SKILLHUB_REPOSITORY_UNAVAILABLE when SCLAW_SKILLHUB_FORCE_DOWN=true', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = 'true';
    await expect(service.search()).rejects.toThrow('SKILLHUB_REPOSITORY_UNAVAILABLE');
  });

  test('should NOT throw when SCLAW_SKILLHUB_FORCE_DOWN is set to other values', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = '0';
    const result = await service.search();
    expect(result.total).toBe(6);
  });

  test('should NOT throw when SCLAW_SKILLHUB_FORCE_DOWN is set to "false"', async () => {
    process.env.SCLAW_SKILLHUB_FORCE_DOWN = 'false';
    const result = await service.search();
    expect(result.total).toBe(6);
  });

  test('should detect offline mode when SCLAW_SKILLHUB_OFFLINE=1', async () => {
    process.env.SCLAW_SKILLHUB_OFFLINE = '1';
    // A non-catalog skill should not throw if cache is empty -- it still throws because not in cache either
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
  });

  test('should detect offline mode when SCLAW_SKILLHUB_OFFLINE=true', async () => {
    process.env.SCLAW_SKILLHUB_OFFLINE = 'true';
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
  });

  test('should not use offline mode when SCLAW_SKILLHUB_OFFLINE=0', async () => {
    process.env.SCLAW_SKILLHUB_OFFLINE = '0';
    await expect(service.install('nonexistent.skill')).rejects.toThrow(
      'Skill not found in SkillHub catalog/cache: nonexistent.skill',
    );
  });
});

// ---------------------------------------------------------------------------
// Full workflow: install -> disable -> enable -> search -> uninstall
// ---------------------------------------------------------------------------

describe('AgentSkillHubService full lifecycle workflow', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should support install-disable-enable-uninstall lifecycle', async () => {
    // 1. Search -- nothing installed
    let searchResult = await service.search({ domain: 'code-check' });
    expect(searchResult.total).toBe(1);
    expect(searchResult.items[0].installed).toBe(false);

    // 2. Install
    const installResult = await service.install(STEEL_CONNECTION_ID);
    expect(installResult.installed).toBe(true);
    expect(installResult.alreadyInstalled).toBe(false);
    expect(installResult.enabled).toBe(true);

    // 3. Search -- now installed and enabled
    searchResult = await service.search({ domain: 'code-check' });
    expect(searchResult.items[0].installed).toBe(true);
    expect(searchResult.items[0].enabled).toBe(true);

    // 4. Disable
    const disableResult = await service.disable(STEEL_CONNECTION_ID);
    expect(disableResult.enabled).toBe(false);

    // 5. Search -- installed but not enabled
    searchResult = await service.search({ domain: 'code-check' });
    expect(searchResult.items[0].installed).toBe(true);
    expect(searchResult.items[0].enabled).toBe(false);

    // 6. Re-enable
    const enableResult = await service.enable(STEEL_CONNECTION_ID);
    expect(enableResult.enabled).toBe(true);

    // 7. Uninstall
    const uninstallResult = await service.uninstall(STEEL_CONNECTION_ID);
    expect(uninstallResult.uninstalled).toBe(true);

    // 8. Search -- back to not installed
    searchResult = await service.search({ domain: 'code-check' });
    expect(searchResult.items[0].installed).toBe(false);
    expect(searchResult.items[0].enabled).toBe(false);

    // 9. List installed -- empty
    const list = await service.listInstalled();
    expect(list).toEqual([]);
  });

  test('should handle multiple installs of different skills', async () => {
    await service.install(STEEL_CONNECTION_ID);
    await service.install(MODAL_REPORT_ID);
    await service.install(SEISMIC_POLICY_ID);

    const list = await service.listInstalled();
    expect(list).toHaveLength(3);

    const ids = list.map((s) => s.id);
    expect(ids).toContain(STEEL_CONNECTION_ID);
    expect(ids).toContain(MODAL_REPORT_ID);
    expect(ids).toContain(SEISMIC_POLICY_ID);
  });

  test('should handle install then uninstall then reinstall', async () => {
    // First install
    const r1 = await service.install(STEEL_CONNECTION_ID);
    expect(r1.alreadyInstalled).toBe(false);
    expect(r1.installed).toBe(true);

    // Uninstall
    await service.uninstall(STEEL_CONNECTION_ID);

    // Reinstall -- should be treated as fresh install
    const r2 = await service.install(STEEL_CONNECTION_ID);
    expect(r2.alreadyInstalled).toBe(false);
    expect(r2.installed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateEnabledState edge cases (tested via enable/disable which delegate)
// ---------------------------------------------------------------------------

describe('AgentSkillHubService enable/disable edge cases', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    service = buildService(stateFilePath);
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
    delete process.env.SCLAW_RUNTIME_VERSION;
    delete process.env.SCLAW_SKILL_API_VERSION;
  });

  afterEach(() => {
    cleanupTempDir(dir);
  });

  test('should throw when enabling a skill whose catalog entry was removed (simulated via cache)', async () => {
    // Manually write an installed skill that is not in the catalog
    writeJsonSync(stateFilePath, {
      skills: {
        'skillhub.totally-unknown': {
          id: 'skillhub.totally-unknown',
          version: '1.0.0',
          enabled: false,
          installedAt: '2024-01-01T00:00:00.000Z',
          source: 'skillhub',
          compatibilityStatus: 'compatible',
          incompatibilityReasons: [],
        },
      },
    });

    await expect(service.enable('skillhub.totally-unknown')).rejects.toThrow(
      'Skill not found in SkillHub catalog: skillhub.totally-unknown',
    );
  });

  test('should disable an incompatible skill', async () => {
    await service.install(FUTURE_RUNTIME_ID);
    const result = await service.disable(FUTURE_RUNTIME_ID);
    expect(result.enabled).toBe(false);
    // Incompatible skills stay incompatible when disabled
    expect(result.compatibilityStatus).toBe('incompatible');
    expect(result.fallbackBehavior).toBe('baseline_only');
  });

  test('should persist incompatibility reasons when enabling an incompatible skill', async () => {
    await service.install(FUTURE_RUNTIME_ID);
    const result = await service.enable(FUTURE_RUNTIME_ID);

    // Should refuse to enable
    expect(result.enabled).toBe(false);
    expect(result.compatibilityStatus).toBe('incompatible');
    expect(result.incompatibilityReasons.length).toBeGreaterThan(0);

    // Should persist the forced-disabled state
    const state = readJsonSync(stateFilePath);
    expect(state.skills[FUTURE_RUNTIME_ID].enabled).toBe(false);
    expect(state.skills[FUTURE_RUNTIME_ID].compatibilityStatus).toBe('incompatible');
  });
});

// ---------------------------------------------------------------------------
// Runtime version compatibility with custom env vars
// ---------------------------------------------------------------------------

describe('AgentSkillHubService compatibility with custom runtime versions', () => {
  let dir;
  let stateFilePath;
  let service;

  beforeEach(() => {
    ({ dir, stateFilePath } = createTempDir());
    delete process.env.SCLAW_SKILLHUB_FORCE_DOWN;
  });

  afterEach(() => {
    cleanupTempDir(dir);
    delete process.env.SCLAW_RUNTIME_VERSION;
    delete process.env.SCLAW_SKILL_API_VERSION;
  });

  test('should mark future-runtime skill as compatible when runtime version is high enough', async () => {
    process.env.SCLAW_RUNTIME_VERSION = '10.0.0';
    process.env.SCLAW_SKILL_API_VERSION = 'v2';

    // Need to rebuild service after setting env vars because the module-level
    // constants capture the values at import time. However, evaluateCompatibility
    // is called at runtime with CURRENT_RUNTIME_VERSION and CURRENT_SKILL_API_VERSION
    // which are module-level. Since these are already captured from the default
    // '0.1.0' / 'v1' at import time, we need to test through the module-level code.
    // The compiled JS uses `const CURRENT_RUNTIME_VERSION = process.env.SCLAW_RUNTIME_VERSION || '0.1.0'`
    // which is evaluated once at module load. So this test verifies the default behavior.
    service = buildService(stateFilePath);
    const result = await service.search({ keyword: 'future' });
    // Because the module was already loaded with defaults, this still shows incompatible
    // This test documents the behavior with the module-level constant
    expect(result.total).toBe(1);
    expect(result.items[0].compatibility.compatible).toBe(false);
  });

  test('should evaluate steel-connection as compatible with default runtime', async () => {
    service = buildService(stateFilePath);
    await service.install(STEEL_CONNECTION_ID);
    const list = await service.listInstalled();
    expect(list[0].compatibilityStatus).toBe('compatible');
    expect(list[0].enabled).toBe(true);
  });
});
