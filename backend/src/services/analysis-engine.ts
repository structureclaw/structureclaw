import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { AnalysisExecutionService } from './analysis-execution.js';

export interface AnalysisEngineManifest {
  id: string;
  name: string;
  version: string;
  kind: 'python' | 'http';
  capabilities: string[];
  supportedAnalysisTypes?: string[];
  supportedModelFamilies?: string[];
  priority?: number;
  routingHints?: string[];
  enabled?: boolean;
  baseUrl?: string;
  authTokenEnv?: string;
  timeoutMs?: number;
  adapterKey?: string;
  constraints?: Record<string, unknown>;
  installedSource?: string;
  healthcheckPath?: string;
  checkMode?: 'ping' | 'analyze' | 'validate';
}

export class AnalysisEngineCatalogService {
  private readonly manifestPath: string;
  private readonly executionService: AnalysisExecutionService;

  constructor() {
    this.manifestPath = config.analysisEngineManifestPath;
    this.executionService = new AnalysisExecutionService();
  }

  async listEngines() {
    return this.executionService.listEngines();
  }

  async getEngine(id: string) {
    return this.executionService.getEngine(id);
  }

  async checkEngine(id: string) {
    return this.executionService.checkEngine(id);
  }

  getManifestSchema() {
    return {
      allowedKinds: ['python', 'http'],
      allowedCapabilities: ['analyze', 'validate', 'code-check'],
      allowedAnalysisTypes: ['static', 'dynamic', 'seismic', 'nonlinear'],
      allowedModelFamilies: ['frame', 'truss', 'generic'],
      allowedAdapterKeys: ['builtin-opensees', 'builtin-simplified'],
      allowedCheckModes: ['ping', 'analyze', 'validate'],
      requiredFields: ['id', 'name', 'version', 'kind', 'capabilities'],
      httpRequiredFields: ['baseUrl', 'supportedAnalysisTypes', 'supportedModelFamilies'],
      pythonRequiredFields: ['adapterKey'],
    };
  }

  async installEngine(manifest: AnalysisEngineManifest) {
    this.assertManifestIsAllowed(manifest);
    const current = await this.readInstalledManifests();
    const next = current.filter((item) => item.id !== manifest.id);
    next.push({
      ...manifest,
      enabled: manifest.enabled ?? true,
      installedSource: manifest.installedSource || 'api',
    });
    await this.writeInstalledManifests(next);
    return { success: true, engine: manifest };
  }

  async setEngineEnabled(id: string, enabled: boolean) {
    const current = await this.readInstalledManifests();
    const existing = current.find((item) => item.id === id);
    if (!existing) {
      throw new Error(`Analysis engine '${id}' not found in installed manifests`);
    }
    const next = current.map((item) => (item.id === id ? { ...item, enabled } : item));
    await this.writeInstalledManifests(next);
    return { success: true, id, enabled };
  }

  private async readInstalledManifests(): Promise<AnalysisEngineManifest[]> {
    try {
      const raw = await readFile(this.manifestPath, 'utf-8');
      const payload = JSON.parse(raw);
      const manifests = Array.isArray(payload) ? payload : payload?.engines;
      return Array.isArray(manifests) ? manifests : [];
    } catch {
      return [];
    }
  }

  private async writeInstalledManifests(manifests: AnalysisEngineManifest[]) {
    await mkdir(path.dirname(this.manifestPath), { recursive: true });
    await writeFile(this.manifestPath, JSON.stringify({ engines: manifests }, null, 2));
  }

  private assertManifestIsAllowed(manifest: AnalysisEngineManifest) {
    if (manifest.kind === 'python') {
      const allowedAdapterKeys = new Set(['builtin-opensees', 'builtin-simplified']);
      if (!manifest.adapterKey || !allowedAdapterKeys.has(manifest.adapterKey)) {
        throw new Error('Python engine manifests must reference a whitelisted adapterKey');
      }
      return;
    }

    if (!manifest.baseUrl?.trim()) {
      throw new Error('HTTP engine manifests must include a baseUrl');
    }
    if (!Array.isArray(manifest.supportedAnalysisTypes) || manifest.supportedAnalysisTypes.length === 0) {
      throw new Error('HTTP engine manifests must declare supportedAnalysisTypes');
    }
    if (!Array.isArray(manifest.supportedModelFamilies) || manifest.supportedModelFamilies.length === 0) {
      throw new Error('HTTP engine manifests must declare supportedModelFamilies');
    }
  }
}
