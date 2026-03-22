import { describe, expect, test } from '@jest/globals';

describe('analysis runtime compatibility routes', () => {
  test('should expose legacy analysis endpoints from backend root', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(process.cwd() + '/backend/package.json');
    const Fastify = require('fastify');

    const { AnalysisExecutionService } = await import('../dist/services/analysis-execution.js');
    AnalysisExecutionService.prototype.getStructureModelSchema = async function mockStructureSchema() {
      return { title: 'StructureModelV1' };
    };
    AnalysisExecutionService.prototype.getConverterSchema = async function mockConverterSchema() {
      return { supportedFormats: ['structuremodel-v1'] };
    };
    AnalysisExecutionService.prototype.listEngines = async function mockListEngines() {
      return { engines: [{ id: 'builtin-opensees' }], defaultSelectionMode: 'auto' };
    };
    AnalysisExecutionService.prototype.getEngine = async function mockGetEngine(id) {
      return id === 'builtin-opensees' ? { id } : null;
    };
    AnalysisExecutionService.prototype.checkEngine = async function mockCheckEngine(id) {
      return { engine: { id } };
    };
    AnalysisExecutionService.prototype.validate = async function mockValidate(body) {
      return { valid: true, echo: body.engineId };
    };
    AnalysisExecutionService.prototype.convert = async function mockConvert() {
      return { model: { schema_version: '1.0.0' } };
    };
    AnalysisExecutionService.prototype.analyze = async function mockAnalyze(body) {
      return { success: true, analysis_type: body.type };
    };
    AnalysisExecutionService.prototype.codeCheck = async function mockCodeCheck(body) {
      return { code: body.code, status: 'success' };
    };

    const { analysisRuntimeCompatibilityRoutes } = await import('../dist/api/analysis-runtime.js');

    const app = Fastify();
    await app.register(analysisRuntimeCompatibilityRoutes);

    expect((await app.inject({ method: 'GET', url: '/schema/structure-model-v1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/schema/converters' })).json().supportedFormats).toContain('structuremodel-v1');
    expect((await app.inject({ method: 'GET', url: '/engines' })).json().engines[0].id).toBe('builtin-opensees');
    expect((await app.inject({ method: 'GET', url: '/engines/builtin-opensees' })).json().id).toBe('builtin-opensees');
    expect((await app.inject({ method: 'POST', url: '/engines/builtin-opensees/check' })).json().engine.id).toBe('builtin-opensees');
    expect((await app.inject({ method: 'POST', url: '/validate', payload: { model: {}, engineId: 'builtin-opensees' } })).json().valid).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/convert', payload: { model: {} } })).json().model.schema_version).toBe('1.0.0');
    expect((await app.inject({ method: 'POST', url: '/analyze', payload: { type: 'static', model: {}, parameters: {} } })).json().success).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/code-check', payload: { model_id: 'm1', code: 'GB50017', elements: [] } })).json().code).toBe('GB50017');

    await app.close();
  });
});
