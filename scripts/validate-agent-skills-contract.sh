#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build --prefix backend >/dev/null

node - <<'JS'
const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const run = async () => {
  const { AgentService } = await import('./backend/dist/services/agent.js');
  const svc = new AgentService();
  svc.engineClient.post = async (path, payload) => {
    if (path === '/validate') {
      return { data: { valid: true, schemaVersion: '1.0.0' } };
    }
    if (path === '/analyze') {
      return {
        data: {
          schema_version: '1.0.0',
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: 'ok',
          data: {},
          meta: {},
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  };
  const skills = svc.listSkills();

  assert(Array.isArray(skills) && skills.length >= 4, 'should expose local markdown skills');

  const required = ['beam', 'truss', 'portal-frame', 'double-span-beam'];
  for (const id of required) {
    const skill = skills.find((item) => item.id === id);
    assert(skill, `missing skill ${id}`);
    assert(typeof skill.name?.zh === 'string' && skill.name.zh.length > 0, `${id} should include zh name`);
    assert(typeof skill.name?.en === 'string' && skill.name.en.length > 0, `${id} should include en name`);
    assert(Array.isArray(skill.stages) && skill.stages.includes('draft'), `${id} should include draft stage`);
    assert(Array.isArray(skill.triggers) && skill.triggers.length > 0, `${id} should include triggers`);
  }

  const result = await svc.run({
    message: '按双跨梁建模，每跨4m，中跨节点施加12kN竖向荷载做静力分析',
    mode: 'execute',
    context: {
      skillIds: ['double-span-beam'],
      userDecision: 'allow_auto_decide',
      autoCodeCheck: false,
      includeReport: false,
    },
  });
  assert(result.success === true, 'selected local skill should still execute');
  assert(Array.isArray(result.model?.elements) && result.model.elements.length === 2, 'double-span-beam skill should generate a 2-element model');

  const filtered = await svc.run({
    message: '我想设计一个梁',
    mode: 'chat',
    context: {
      skillIds: ['truss'],
    },
  });
  assert(filtered.interaction?.detectedScenario !== 'beam', 'skill filter should restrict automatic beam matching');

  console.log('[ok] agent markdown skill contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
