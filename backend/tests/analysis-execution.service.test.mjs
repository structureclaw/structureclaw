import { describe, expect, test } from '@jest/globals';
import {
  AnalysisExecutionService,
  createLocalAnalysisEngineClient,
} from '../dist/services/analysis-execution.js';

describe('AnalysisExecutionService and local client', () => {
  test('should map service calls to worker actions', async () => {
    const calls = [];
    const fakeRunner = {
      invoke: async (payload) => {
        calls.push(payload);
        switch (payload.action) {
          case 'list_engines':
            return { engines: [{ id: 'builtin-opensees' }], defaultSelectionMode: 'auto' };
          case 'get_engine':
            return { id: payload.engineId };
          case 'check_engine':
            return { engine: { id: payload.engineId } };
          case 'validate':
          case 'convert':
          case 'analyze':
          case 'code_check':
            return { ok: payload.action, input: payload.input };
          default:
            return {};
        }
      },
    };

    const service = new AnalysisExecutionService(fakeRunner);
    await service.listEngines();
    await service.getEngine('builtin-opensees');
    await service.checkEngine('builtin-opensees');
    await service.validate({ model: {} });
    await service.convert({ model: {} });
    await service.analyze({ type: 'static', model: {}, parameters: {} });
    await service.codeCheck({ model_id: 'm1', code: 'GB50017', elements: [] });

    expect(calls.map((item) => item.action)).toEqual([
      'list_engines',
      'get_engine',
      'check_engine',
      'validate',
      'convert',
      'analyze',
      'code_check',
    ]);
  });

  test('should expose legacy local client paths', async () => {
    const calls = [];
    const fakeRunner = {
      invoke: async (payload) => {
        calls.push(payload);
        if (payload.action === 'get_engine') {
          return { id: payload.engineId };
        }
        if (payload.action === 'check_engine') {
          return { checked: payload.engineId };
        }
        return { action: payload.action, input: payload.input };
      },
    };

    const client = createLocalAnalysisEngineClient(new AnalysisExecutionService(fakeRunner));
    expect((await client.get('/schema/converters')).data.action).toBe('converter_schema');
    expect((await client.get('/engines/builtin-opensees')).data.id).toBe('builtin-opensees');
    expect((await client.post('/engines/builtin-opensees/check')).data.checked).toBe('builtin-opensees');
    expect((await client.post('/analyze', { type: 'static' })).data.action).toBe('analyze');
  });
});
