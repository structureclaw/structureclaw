import axios from 'axios';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { buildProxyConfig } from '../utils/http.js';

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
}

export class AnalysisEngineCatalogService {
  private engineUrl: string;
  private engineProxyConfig: { proxy?: false };
  private manifestPath: string;

  constructor() {
    this.engineUrl = config.analysisEngineUrl;
    this.engineProxyConfig = buildProxyConfig(this.engineUrl);
    this.manifestPath = config.analysisEngineManifestPath;
  }

  async listEngines() {
    const response = await axios.get(`${this.engineUrl}/engines`, this.engineProxyConfig);
    return response.data;
  }

  async getEngine(id: string) {
    const payload = await this.listEngines();
    const engines = Array.isArray(payload?.engines) ? payload.engines : [];
    return engines.find((engine: { id?: string }) => engine.id === id) || null;
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
  }
}
