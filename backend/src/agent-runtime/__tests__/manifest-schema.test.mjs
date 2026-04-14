import { describe, expect, test } from '@jest/globals';
import { skillManifestFileSchema } from '../../../dist/agent-runtime/manifest-schema.js';

describe('skill manifest runtime contract', () => {
  test('accepts provider runtime contract with providerSlot', () => {
    const parsed = skillManifestFileSchema.parse({
      id: 'analysis-opensees-static',
      domain: 'analysis',
      source: 'builtin',
      name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
      description: { zh: '静力分析 provider', en: 'Static analysis provider' },
      triggers: ['analysis'],
      stages: ['analysis'],
      structureType: 'unknown',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      runtimeContract: {
        role: 'provider',
        providerSlot: 'analysisProvider',
        selectionPolicy: 'explicit_required',
        cardinality: 'singleton',
        consumes: ['analysisModel'],
        provides: ['analysisRaw'],
        runtimeAdapter: 'builtin-opensees',
        supportedAnalysisTypes: ['static'],
        supportedModelFamilies: ['frame', 'generic'],
      },
    });

    expect(parsed.runtimeContract.providerSlot).toBe('analysisProvider');
    expect(parsed.runtimeContract.cardinality).toBe('singleton');
  });

  test('rejects provider runtime contracts without a provider slot', () => {
    expect(() => skillManifestFileSchema.parse({
      id: 'analysis-invalid',
      domain: 'analysis',
      source: 'builtin',
      name: { zh: '无效分析', en: 'Invalid Analysis' },
      description: { zh: '缺少 provider slot', en: 'Missing provider slot' },
      triggers: ['analysis'],
      stages: ['analysis'],
      structureType: 'unknown',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      runtimeContract: {
        role: 'provider',
        provides: ['analysisRaw'],
      },
    })).toThrow();
  });

  test('accepts consumer runtime contract with required/optional consumes', () => {
    const parsed = skillManifestFileSchema.parse({
      id: 'report-export-builtin',
      domain: 'report-export',
      source: 'builtin',
      name: { zh: '报告导出', en: 'Report Export' },
      description: { zh: '导出报告', en: 'Export report' },
      triggers: ['report'],
      stages: ['analysis'],
      structureType: 'unknown',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      runtimeContract: {
        role: 'consumer',
        targetArtifact: 'reportArtifact',
        requiredConsumes: ['designBasis', 'normalizedModel'],
        optionalConsumes: ['postprocessedResult', 'codeCheckResult'],
      },
    });

    expect(parsed.runtimeContract.requiredConsumes).toEqual(['designBasis', 'normalizedModel']);
    expect(parsed.runtimeContract.optionalConsumes).toEqual(['postprocessedResult', 'codeCheckResult']);
  });

  test('accepts designer runtime contract', () => {
    const parsed = skillManifestFileSchema.parse({
      id: 'design-steel',
      domain: 'design',
      source: 'builtin',
      name: { zh: '钢结构设计', en: 'Steel Design' },
      description: { zh: '设计修订', en: 'Design revision' },
      triggers: ['design'],
      stages: ['design'],
      structureType: 'unknown',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      runtimeContract: {
        role: 'designer',
        providesPatches: ['designPatch'],
        requiresUserAcceptance: true,
        autoIteration: { supported: true, defaultEnabled: false },
        consumes: ['designBasis', 'normalizedModel', 'postprocessedResult', 'codeCheckResult'],
      },
    });

    expect(parsed.runtimeContract.role).toBe('designer');
    expect(parsed.runtimeContract.providesPatches).toEqual(['designPatch']);
    expect(parsed.runtimeContract.autoIteration.defaultEnabled).toBe(false);
  });

  test('accepts transformer runtime contract', () => {
    const parsed = skillManifestFileSchema.parse({
      id: 'result-postprocess-builtin',
      domain: 'result-postprocess',
      source: 'builtin',
      name: { zh: '结果后处理', en: 'Result Postprocess' },
      description: { zh: '后处理', en: 'Postprocess' },
      triggers: ['postprocess'],
      stages: ['analysis'],
      structureType: 'unknown',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      runtimeContract: {
        role: 'transformer',
        consumes: ['analysisRaw'],
        provides: ['postprocessedResult'],
      },
    });

    expect(parsed.runtimeContract.role).toBe('transformer');
  });

  test.each([
    ['entry'],
    ['enricher'],
    ['validator'],
    ['assistant'],
  ])('accepts %s runtime contract', (role) => {
    const parsed = skillManifestFileSchema.parse({
      id: `skill-${role}`,
      domain: 'general',
      source: 'builtin',
      name: { zh: `${role} skill`, en: `${role} skill` },
      description: { zh: `${role}`, en: `${role}` },
      triggers: [role],
      stages: ['intent'],
      structureType: 'unknown',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      runtimeContract: {
        role,
        consumes: ['draftState'],
        provides: ['designBasis'],
      },
    });

    expect(parsed.runtimeContract.role).toBe(role);
    expect(parsed.runtimeContract.consumes).toEqual(['draftState']);
  });

  test('manifest without runtimeContract parses cleanly (backward compat)', () => {
    const parsed = skillManifestFileSchema.parse({
      id: 'legacy-skill',
      domain: 'general',
      source: 'builtin',
      name: { zh: '旧技能', en: 'Legacy Skill' },
      description: { zh: '无合约', en: 'No contract' },
      triggers: ['legacy'],
      stages: ['intent'],
      structureType: 'unknown',
      compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
    });

    expect(parsed.runtimeContract).toBeUndefined();
  });
});
