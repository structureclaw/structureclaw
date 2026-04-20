import type { AnalysisEngineManifest } from './analysis-engine.js';
import {
  AnalysisRuntimeRunner,
  LOCAL_GET_ACTION_BY_PATH,
  LOCAL_POST_ACTION_BY_PATH,
} from '../agent-skills/analysis/entry.js';
import type { ExecutionRequestOptions, LocalAnalysisEngineClient } from '../agent-skills/analysis/types.js';

function buildError(message: string, statusCode = 500): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

export class AnalysisExecutionService {
  constructor(private readonly runner = new AnalysisRuntimeRunner()) {}

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

  async probeEngine(id: string): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'probe_engine', engineId: id });
  }

  async analyze(payload: Record<string, unknown>, requestOptions?: ExecutionRequestOptions): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'analyze', input: payload }, requestOptions);
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
        default:
          throw buildError(`Unsupported local GET action: ${action}`, 400);
      }
    },
    async post<T = unknown>(path: string, payload: Record<string, unknown> = {}, requestOptions?: ExecutionRequestOptions): Promise<{ data: T }> {
      if (path.startsWith('/engines/') && path.endsWith('/check')) {
        const engineId = decodeURIComponent(path.slice('/engines/'.length, -'/check'.length));
        return { data: await service.checkEngine(engineId) as T };
      }
      if (path.startsWith('/engines/') && path.endsWith('/probe')) {
        const engineId = decodeURIComponent(path.slice('/engines/'.length, -'/probe'.length));
        return { data: await service.probeEngine(engineId) as T };
      }
      const action = LOCAL_POST_ACTION_BY_PATH[path];
      if (!action) {
        throw buildError(`Unsupported local POST path: ${path}`, 400);
      }
      switch (action) {
        case 'analyze':
          return { data: await service.analyze(payload, requestOptions) as T };
        default:
          throw buildError(`Unsupported local POST action: ${action}`, 400);
      }
    },
  };
}
