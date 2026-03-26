import type { AgentAnalysisType } from '../../agent-runtime/types.js';
import type {
  AnalysisModelFamily,
  AnalysisRuntimeAdapterKey,
  AnalysisSkillManifest,
  AnalysisSoftware,
  BuiltInAnalysisEngineId,
} from './types.js';

const SOFTWARE_RUNTIME_CONFIG: Record<AnalysisSoftware, {
  engineId: BuiltInAnalysisEngineId;
  adapterKey: AnalysisRuntimeAdapterKey;
  runtimeAdapterModule: string;
}> = {
  opensees: {
    engineId: 'builtin-opensees',
    adapterKey: 'builtin-opensees',
    runtimeAdapterModule: 'adapters.opensees.provider',
  },
  simplified: {
    engineId: 'builtin-simplified',
    adapterKey: 'builtin-simplified',
    runtimeAdapterModule: 'adapters.simplified.provider',
  },
};

export function createAnalysisSkillManifest(options: {
  id: string;
  name: AnalysisSkillManifest['name'];
  description: AnalysisSkillManifest['description'];
  software: AnalysisSoftware;
  analysisType: AgentAnalysisType;
  triggers: string[];
  priority: number;
  capabilities?: string[];
  supportedModelFamilies?: AnalysisModelFamily[];
  autoLoadByDefault?: boolean;
}): AnalysisSkillManifest {
  const runtime = SOFTWARE_RUNTIME_CONFIG[options.software];

  return {
    id: options.id,
    domain: 'analysis-strategy',
    name: options.name,
    description: options.description,
    software: options.software,
    analysisType: options.analysisType,
    engineId: runtime.engineId,
    adapterKey: runtime.adapterKey,
    triggers: options.triggers,
    capabilities: options.capabilities ?? ['analysis-policy', 'analysis-execution'],
    supportedModelFamilies: options.supportedModelFamilies ?? ['frame', 'truss', 'generic'],
    priority: options.priority,
    autoLoadByDefault: options.autoLoadByDefault ?? true,
    runtimeAdapterModule: runtime.runtimeAdapterModule,
  };
}
