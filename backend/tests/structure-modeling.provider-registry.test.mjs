import { describe, expect, test } from '@jest/globals';
import { AgentSkillLoader } from '../dist/agent-skills/runtime/loader.js';
import {
  listStructureModelingProviders,
  loadStructureModelingExecutableProviders,
} from '../dist/agent-skills/structure-modeling/registry.js';

describe('structure-modeling provider registry', () => {
  test('should expose built-in providers in deterministic priority order', async () => {
    const loader = new AgentSkillLoader();
    const providers = listStructureModelingProviders({
      builtInPlugins: await loader.loadPlugins(),
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      'portal-frame',
      'double-span-beam',
      'truss',
      'frame',
      'beam',
    ]);
  });

  test('should preserve explicit skill selection semantics through the provider wrapper', async () => {
    const loader = new AgentSkillLoader();
    const providers = listStructureModelingProviders({
      builtInPlugins: await loader.loadPlugins(),
    });
    const requested = new Set(['frame', 'beam']);

    const selected = providers
      .filter((provider) => requested.has(provider.id))
      .map((provider) => provider.id);

    expect(selected).toEqual(['frame', 'beam']);
  });

  test('should merge external providers by priority without changing built-in ordering rules', async () => {
    const loader = new AgentSkillLoader();
    const [framePlugin] = (await loader.loadPlugins()).filter((plugin) => plugin.id === 'frame');
    const providers = listStructureModelingProviders({
      builtInPlugins: await loader.loadPlugins(),
      externalProviders: [{
        id: 'frame-ext',
        domain: 'structure-modeling',
        source: 'skillhub',
        priority: 85,
        manifest: {
          ...framePlugin.manifest,
          id: 'frame-ext',
          name: {
            zh: '外部框架',
            en: 'External Frame',
          },
        },
        handler: framePlugin.handler,
        plugin: {
          ...framePlugin,
          id: 'frame-ext',
          manifest: {
            ...framePlugin.manifest,
            id: 'frame-ext',
            name: {
              zh: '外部框架',
              en: 'External Frame',
            },
          },
        },
      }],
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      'portal-frame',
      'double-span-beam',
      'frame-ext',
      'truss',
      'frame',
      'beam',
    ]);
  });

  test('should load executable structure-modeling providers from package entrypoints', async () => {
    const loader = new AgentSkillLoader();
    const [framePlugin] = (await loader.loadPlugins()).filter((plugin) => plugin.id === 'frame');
    const result = await loadStructureModelingExecutableProviders({
      packages: [{
        id: 'frame-pack',
        domain: 'structure-type',
        version: '1.0.0',
        source: 'skillhub',
        capabilities: ['intent-detection'],
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
        entrypoints: {
          structureModeling: 'dist/structure-modeling.js',
        },
        enabledByDefault: false,
        priority: 95,
      }],
      importModule: async () => ({
        manifest: {
          ...framePlugin.manifest,
          id: 'frame-pack',
          autoLoadByDefault: true,
        },
        handler: framePlugin.handler,
      }),
    });

    expect(result.failures).toEqual([]);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].id).toBe('frame-pack');
    expect(result.providers[0].source).toBe('skillhub');
    expect(result.providers[0].priority).toBe(95);
    expect(result.providers[0].plugin.autoLoadByDefault).toBe(false);
  });
});
