import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../utils/database.js';
import type { InputJsonValue, JsonValue } from '../utils/json.js';

export type AgentMemoryScopeType = 'conversation' | 'workspace';

export interface AgentMemoryScope {
  scopeType: AgentMemoryScopeType;
  scopeId: string;
}

export interface AgentMemoryEntryView {
  scopeType: AgentMemoryScopeType;
  scopeId: string;
  key: string;
  value: JsonValue;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Workspace file-backed store (.agent-workspace/workspace-memory.json)
// ---------------------------------------------------------------------------

interface FileStoreEntry {
  value: JsonValue;
  updatedAt: string;
}

type FileStoreData = Record<string, FileStoreEntry>;

export class AgentMemoryFileStore {
  private readonly filePath: string;
  private lastUpdatedAtMs = 0;

  constructor(workspaceRoot: string) {
    const dir = path.join(workspaceRoot, '.agent-workspace');
    this.filePath = path.join(dir, 'workspace-memory.json');
  }

  async store(key: string, value: InputJsonValue): Promise<AgentMemoryEntryView> {
    const normalizedKey = normalizeMemoryKey(key);
    const data = await this.readData();
    const updatedAt = this.nextUpdatedAt(data);
    data[normalizedKey] = { value: value as JsonValue, updatedAt };
    await this.writeData(data);
    return {
      scopeType: 'workspace',
      scopeId: 'default',
      key: normalizedKey,
      value: value as JsonValue,
      updatedAt,
    };
  }

  async retrieve(key: string): Promise<AgentMemoryEntryView | null> {
    const normalizedKey = normalizeMemoryKey(key);
    const data = await this.readData();
    const entry = data[normalizedKey];
    return entry
      ? {
          scopeType: 'workspace',
          scopeId: 'default',
          key: normalizedKey,
          value: entry.value,
          updatedAt: entry.updatedAt,
        }
      : null;
  }

  async list(): Promise<AgentMemoryEntryView[]> {
    const data = await this.readData();
    return Object.entries(data)
      .map(([key, entry]) => ({
        scopeType: 'workspace' as const,
        scopeId: 'default',
        key,
        value: entry.value,
        updatedAt: entry.updatedAt,
      }))
      .sort((a, b) => {
        const cmp = b.updatedAt.localeCompare(a.updatedAt);
        return cmp !== 0 ? cmp : a.key.localeCompare(b.key);
      });
  }

  async delete(key: string): Promise<boolean> {
    const normalizedKey = normalizeMemoryKey(key);
    const data = await this.readData();
    if (!(normalizedKey in data)) return false;
    delete data[normalizedKey];
    await this.writeData(data);
    return true;
  }

  /* for testing */
  getFilePath(): string {
    return this.filePath;
  }

  private async readData(): Promise<FileStoreData> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    try {
      return JSON.parse(raw) as FileStoreData;
    } catch (err) {
      throw new Error(
        `Corrupt workspace memory file (${this.filePath}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async writeData(data: FileStoreData): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.workspace-memory-${crypto.randomUUID()}.tmp`);
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.promises.rename(tmp, this.filePath);
  }

  private nextUpdatedAt(data: FileStoreData): string {
    const persistedMaxMs = Object.values(data).reduce((max, entry) => {
      const ms = Date.parse(entry.updatedAt);
      return Number.isFinite(ms) && ms > max ? ms : max;
    }, 0);
    const nowMs = Date.now();
    const nextMs = Math.max(nowMs, this.lastUpdatedAtMs + 1, persistedMaxMs + 1);
    this.lastUpdatedAtMs = nextMs;
    return new Date(nextMs).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Unified memory service — dispatches by scopeType
// ---------------------------------------------------------------------------

export class AgentMemoryService {
  private readonly fileStore?: AgentMemoryFileStore;

  constructor(workspaceRoot?: string) {
    if (workspaceRoot) {
      this.fileStore = new AgentMemoryFileStore(workspaceRoot);
    }
  }

  async store(scope: AgentMemoryScope, key: string, value: InputJsonValue): Promise<AgentMemoryEntryView> {
    if (scope.scopeType === 'workspace') {
      if (!this.fileStore) throw new Error('Workspace memory requires a workspaceRoot.');
      return this.fileStore.store(key, value);
    }
    const normalizedKey = normalizeMemoryKey(key);
    const entry = await prisma.agentMemoryEntry.upsert({
      where: {
        scopeType_scopeId_key: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          key: normalizedKey,
        },
      },
      create: {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        key: normalizedKey,
        value,
      },
      update: { value },
    });
    return {
      scopeType: entry.scopeType as AgentMemoryScopeType,
      scopeId: entry.scopeId,
      key: entry.key,
      value: entry.value,
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  async retrieve(scope: AgentMemoryScope, key: string): Promise<AgentMemoryEntryView | null> {
    if (scope.scopeType === 'workspace') {
      if (!this.fileStore) throw new Error('Workspace memory requires a workspaceRoot.');
      return this.fileStore.retrieve(key);
    }
    const normalizedKey = normalizeMemoryKey(key);
    const entry = await prisma.agentMemoryEntry.findUnique({
      where: {
        scopeType_scopeId_key: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          key: normalizedKey,
        },
      },
    });
    return entry
      ? {
          scopeType: entry.scopeType as AgentMemoryScopeType,
          scopeId: entry.scopeId,
          key: entry.key,
          value: entry.value,
          updatedAt: entry.updatedAt.toISOString(),
        }
      : null;
  }

  async list(scope: AgentMemoryScope): Promise<AgentMemoryEntryView[]> {
    if (scope.scopeType === 'workspace') {
      if (!this.fileStore) throw new Error('Workspace memory requires a workspaceRoot.');
      return this.fileStore.list();
    }
    const entries = await prisma.agentMemoryEntry.findMany({
      where: { scopeType: scope.scopeType, scopeId: scope.scopeId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return entries.map((entry: any) => ({
      scopeType: entry.scopeType as AgentMemoryScopeType,
      scopeId: entry.scopeId,
      key: entry.key,
      value: entry.value,
      updatedAt: entry.updatedAt.toISOString(),
    }));
  }

  async delete(scope: AgentMemoryScope, key: string): Promise<boolean> {
    if (scope.scopeType === 'workspace') {
      if (!this.fileStore) throw new Error('Workspace memory requires a workspaceRoot.');
      return this.fileStore.delete(key);
    }
    const normalizedKey = normalizeMemoryKey(key);
    const result = await prisma.agentMemoryEntry.deleteMany({
      where: { scopeType: scope.scopeType, scopeId: scope.scopeId, key: normalizedKey },
    });
    return result.count > 0;
  }
}

export function normalizeMemoryKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new Error('Invalid memory key. Use 1-128 lowercase letters, numbers, dot, underscore, colon, or hyphen.');
  }
  return normalized;
}
