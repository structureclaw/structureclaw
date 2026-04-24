import { prisma } from '../utils/database.js';
import type { InputJsonValue, JsonValue } from '../utils/json.js';

export type AgentMemoryScopeType = 'user' | 'project';

export interface AgentMemoryScope {
  scopeType: AgentMemoryScopeType;
  scopeId: string;
}

export interface AgentMemoryEntryView {
  key: string;
  value: JsonValue;
  updatedAt: string;
}

export class AgentMemoryService {
  async store(scope: AgentMemoryScope, key: string, value: InputJsonValue): Promise<AgentMemoryEntryView> {
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
    return { key: entry.key, value: entry.value, updatedAt: entry.updatedAt.toISOString() };
  }

  async retrieve(scope: AgentMemoryScope, key: string): Promise<AgentMemoryEntryView | null> {
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
    return entry ? { key: entry.key, value: entry.value, updatedAt: entry.updatedAt.toISOString() } : null;
  }

  async list(scope: AgentMemoryScope): Promise<AgentMemoryEntryView[]> {
    const entries = await prisma.agentMemoryEntry.findMany({
      where: { scopeType: scope.scopeType, scopeId: scope.scopeId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return entries.map((entry) => ({ key: entry.key, value: entry.value, updatedAt: entry.updatedAt.toISOString() }));
  }

  async delete(scope: AgentMemoryScope, key: string): Promise<boolean> {
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
