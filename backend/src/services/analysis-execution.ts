import type { AnalysisEngineManifest } from './analysis-engine.js';
import {
  LOCAL_GET_ACTION_BY_PATH,
  LOCAL_POST_ACTION_BY_PATH,
  PythonAnalysisRunner,
} from '../agent-skills/analysis-execution/entry.js';
import type { LocalAnalysisEngineClient } from '../agent-skills/analysis-execution/types.js';

function buildError(message: string, statusCode = 500): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

export class AnalysisExecutionService {
  constructor(private readonly runner = new PythonAnalysisRunner()) {}

  async listEngines(): Promise<{ engines: AnalysisEngineManifest[]; defaultSelectionMode: 'auto' }> {
    return this.runner.invoke({ action: 'list_engines' });
  }

  async getEngine(id: string): Promise<AnalysisEngineManifest | null> {
    try {
      return await this.runner.invoke({ action: 'get_engine', engineId: id });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async checkEngine(id: string): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'check_engine', engineId: id });
  }

  async getStructureModelSchema(): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'structure_model_schema' });
  }

  async getConverterSchema(): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'converter_schema' });
  }

  async validate(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'validate', input: payload });
  }

  async convert(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'convert', input: payload });
  }

  async analyze(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'analyze', input: payload });
  }

  async codeCheck(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'code_check', input: payload });
  }
}

export function createLocalAnalysisEngineClient(
  service = new AnalysisExecutionService(),
): LocalAnalysisEngineClient {
  return {
    async get<T = unknown>(path: string): Promise<{ data: T }> {
      if (path.startsWith('/engines/')) {
        const engineId = decodeURIComponent(path.slice('/engines/'.length));
        return { data: await service.getEngine(engineId) as T };
      }
      const action = LOCAL_GET_ACTION_BY_PATH[path];
      if (!action) {
        throw buildError(`Unsupported local GET path: ${path}`, 400);
      }
      switch (action) {
        case 'list_engines':
          return { data: await service.listEngines() as T };
        case 'structure_model_schema':
          return { data: await service.getStructureModelSchema() as T };
        case 'converter_schema':
          return { data: await service.getConverterSchema() as T };
        default:
          throw buildError(`Unsupported local GET action: ${action}`, 400);
      }
    },
    async post<T = unknown>(path: string, payload: Record<string, unknown> = {}): Promise<{ data: T }> {
      if (path.startsWith('/engines/') && path.endsWith('/check')) {
        const engineId = decodeURIComponent(path.slice('/engines/'.length, -'/check'.length));
        return { data: await service.checkEngine(engineId) as T };
      }
      const action = LOCAL_POST_ACTION_BY_PATH[path];
      if (!action) {
        throw buildError(`Unsupported local POST path: ${path}`, 400);
      }
      switch (action) {
        case 'validate':
          return { data: await service.validate(payload) as T };
        case 'convert':
          return { data: await service.convert(payload) as T };
        case 'analyze':
          return { data: await service.analyze(payload) as T };
        case 'code_check':
          return { data: await service.codeCheck(payload) as T };
        default:
          throw buildError(`Unsupported local POST action: ${action}`, 400);
      }
    },
  };
}
