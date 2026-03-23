import { PythonWorkerRunner, resolveWorkerPath } from '../utils/python-worker-runner.js';

export type StructureProtocolAction =
  | 'structure_model_schema'
  | 'converter_schema'
  | 'validate'
  | 'convert';

export interface StructureProtocolExecutionInput {
  action: StructureProtocolAction;
  input?: Record<string, unknown>;
}

export interface LocalStructureProtocolClient {
  post<T = any>(path: string, payload?: Record<string, unknown>): Promise<{ data: T }>;
  get<T = any>(path: string): Promise<{ data: T }>;
}

const LOCAL_GET_PATHS: Record<string, StructureProtocolAction> = {
  '/schema/structure-model-v1': 'structure_model_schema',
  '/schema/converters': 'converter_schema',
};

const LOCAL_POST_PATHS: Record<string, StructureProtocolAction> = {
  '/validate': 'validate',
  '/convert': 'convert',
};

export class StructureProtocolExecutionService {
  private readonly runner = new PythonWorkerRunner<StructureProtocolExecutionInput>(
    resolveWorkerPath('skill-shared/python/structure_protocol/worker.py'),
  );

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
}

function buildError(message: string, statusCode = 500): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

export function createLocalStructureProtocolClient(
  service = new StructureProtocolExecutionService(),
): LocalStructureProtocolClient {
  return {
    async get<T = unknown>(path: string): Promise<{ data: T }> {
      const action = LOCAL_GET_PATHS[path];
      if (!action) {
        throw buildError(`Unsupported local GET path: ${path}`, 400);
      }
      switch (action) {
        case 'structure_model_schema':
          return { data: await service.getStructureModelSchema() as T };
        case 'converter_schema':
          return { data: await service.getConverterSchema() as T };
        default:
          throw buildError(`Unsupported local GET action: ${String(action)}`, 400);
      }
    },
    async post<T = unknown>(path: string, payload: Record<string, unknown> = {}): Promise<{ data: T }> {
      const action = LOCAL_POST_PATHS[path];
      if (!action) {
        throw buildError(`Unsupported local POST path: ${path}`, 400);
      }
      switch (action) {
        case 'validate':
          return { data: await service.validate(payload) as T };
        case 'convert':
          return { data: await service.convert(payload) as T };
        default:
          throw buildError(`Unsupported local POST action: ${String(action)}`, 400);
      }
    },
  };
}
