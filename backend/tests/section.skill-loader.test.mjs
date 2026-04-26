import { describe, expect, test } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { AgentSkillLoader } from '../dist/agent-runtime/loader.js';

describe('section skill loader', () => {
  test('should discover modular section bundles', () => {
    const loader = new AgentSkillLoader();
    const bundles = loader.loadBundles();
    const ids = bundles.map((bundle) => bundle.id);

    expect(ids).toEqual(expect.arrayContaining([
      'section-common',
      'section-bridge',
      'section-irregular',
    ]));
    expect(ids).not.toContain('section');
  });

  test('should discover the memory utility skill bundle', () => {
    const loader = new AgentSkillLoader();
    const bundle = loader.loadBundles().find((entry) => entry.id === 'memory');

    expect(bundle).toBeDefined();
    expect(bundle?.domain).toBe('general');
    expect(bundle?.markdownByStage.intent).toContain('persistent memory');
  });

  test('should load modular section plugins and keep legacy root plugin removed', async () => {
    const loader = new AgentSkillLoader();
    const plugins = await loader.loadPlugins();
    const pluginIds = plugins.map((plugin) => plugin.id);

    expect(pluginIds).toEqual(expect.arrayContaining([
      'section-common',
      'section-bridge',
      'section-irregular',
    ]));
    expect(pluginIds).not.toContain('section');

    const common = plugins.find((plugin) => plugin.id === 'section-common');
    const bridge = plugins.find((plugin) => plugin.id === 'section-bridge');
    const irregular = plugins.find((plugin) => plugin.id === 'section-irregular');

    expect(common?.manifest.domain).toBe('section');
    expect(bridge?.manifest.domain).toBe('section');
    expect(irregular?.manifest.domain).toBe('section');
    expect(common?.manifest.autoLoadByDefault).toBe(false);
    expect(bridge?.manifest.autoLoadByDefault).toBe(false);
    expect(irregular?.manifest.autoLoadByDefault).toBe(false);
  });

  test('should load plugins by relative skill path and strip CRLF legacy frontmatter', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'structureclaw-loader-'));
    const markdownRoot = path.join(tempRoot, 'markdown-skills');
    const moduleRoot = path.join(tempRoot, 'module-skills');
    const skillDir = path.join(markdownRoot, 'structure-type', 'beam-plugin');
    const moduleSkillDir = path.join(moduleRoot, 'structure-type', 'beam-plugin');

    try {
      await mkdir(skillDir, { recursive: true });
      await mkdir(moduleSkillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, 'skill.yaml'),
        [
          'id: beam-custom',
          'domain: structure-type',
          'source: builtin',
          'name:',
          '  zh: 自定义梁',
          '  en: Custom Beam',
          'description:',
          '  zh: 测试用结构类型 skill',
          '  en: Test structure-type skill',
          'triggers: [beam]',
          'stages: [intent]',
          'structureType: beam',
          'structuralTypeKeys: [beam]',
          'capabilities: []',
          'requires: []',
          'conflicts: []',
          'autoLoadByDefault: false',
          'priority: 90',
          'compatibility:',
          '  minRuntimeVersion: 0.1.0',
          '  skillApiVersion: v1',
          'supportedAnalysisTypes: []',
          'supportedModelFamilies: [frame, generic]',
          'materialFamilies: []',
          'toolHints: {}',
          'aliases: []',
        ].join('\n'),
      );
      await writeFile(
        path.join(skillDir, 'intent.md'),
        ['---', 'legacy: true', '---', '', 'Custom beam intent.'].join('\r\n'),
      );
      await writeFile(
        path.join(moduleSkillDir, 'handler.js'),
        'module.exports = async () => ({ ok: true });\n',
      );

      const loader = new AgentSkillLoader({
        markdownSkillRoot: markdownRoot,
        moduleSkillRoot: moduleRoot,
      });
      const bundles = loader.loadBundles();
      const plugins = await loader.loadPlugins();

      const bundle = bundles.find((entry) => entry.id === 'beam-custom');
      const plugin = plugins.find((entry) => entry.id === 'beam-custom');

      expect(bundle?.markdownByStage.intent).toBe('Custom beam intent.');
      expect(plugin?.id).toBe('beam-custom');
      expect(plugin?.manifest.id).toBe('beam-custom');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
