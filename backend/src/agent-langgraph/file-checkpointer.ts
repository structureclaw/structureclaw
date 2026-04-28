/**
 * File-based checkpoint saver for LangGraph.
 *
 * Persists agent state (conversation + draft state + artifacts) to the local
 * filesystem under a configurable data directory. No Redis or external DB required.
 *
 * Storage layout:
 *   <dataDir>/checkpoints/<threadId>/<checkpointId>.json
 *   <dataDir>/writes/<threadId>/<checkpointId>/<taskId>.json
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from '@langchain/langgraph';
import type { PendingWrite } from '@langchain/langgraph-checkpoint';
import { logger } from '../utils/logger.js';
import { logStateTransition } from '../utils/agent-logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function threadDir(dataDir: string, threadId: string): string {
  return path.join(dataDir, 'checkpoints', threadId);
}

function checkpointPath(dataDir: string, threadId: string, checkpointId: string): string {
  return path.join(threadDir(dataDir, threadId), `${checkpointId}.json`);
}

function writesDir(dataDir: string, threadId: string, checkpointId: string): string {
  return path.join(dataDir, 'writes', threadId, checkpointId);
}

interface CheckpointListOptions {
  limit?: number;
  before?: RunnableConfig;
  filter?: Record<string, unknown>;
}

interface StoredCheckpoint {
  checkpoint: string;   // serde-serialized JSON string
  metadata: string;     // serde-serialized JSON string
  parentCheckpointId?: string;
}

// ---------------------------------------------------------------------------
// FileCheckpointer
// ---------------------------------------------------------------------------

export class FileCheckpointer extends BaseCheckpointSaver {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
    // Ensure directories exist synchronously on construction
    fsSync.mkdirSync(path.join(dataDir, 'checkpoints'), { recursive: true });
    fsSync.mkdirSync(path.join(dataDir, 'writes'), { recursive: true });
  }

  // ----- getTuple -----

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return undefined;

    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    const dir = threadDir(this.dataDir, threadId);

    let targetFile: string | undefined;
    if (checkpointId) {
      targetFile = checkpointPath(this.dataDir, threadId, checkpointId);
    } else {
      try {
        const files = await fs.readdir(dir);
        const jsonFiles = files.filter((f) => f.endsWith('.json'));
        if (jsonFiles.length === 0) return undefined;
        // Select the most recent checkpoint by file modification time
        // (lexicographic sort is unreliable for non-monotonic IDs like UUIDs)
        const latest = (
          await Promise.all(
            jsonFiles.map(async (file) => {
              const filePath = path.join(dir, file);
              const stat = await fs.stat(filePath);
              return { file, filePath, mtimeMs: stat.mtimeMs };
            }),
          )
        ).reduce((best, current) => {
          if (!best) return current;
          if (current.mtimeMs > best.mtimeMs) return current;
          if (current.mtimeMs === best.mtimeMs && current.file > best.file) return current;
          return best;
        }, undefined as { file: string; filePath: string; mtimeMs: number } | undefined);
        if (!latest) return undefined;
        targetFile = latest.filePath;
      } catch {
        return undefined;
      }
    }

    try {
      const raw = await fs.readFile(targetFile, 'utf-8');
      const stored: StoredCheckpoint = JSON.parse(raw);
      const deserializedCheckpoint = await this.serde.loadsTyped('json', stored.checkpoint) as Checkpoint;
      const deserializedMetadata = await this.serde.loadsTyped('json', stored.metadata) as CheckpointMetadata;
      logStateTransition(logger, { node: 'checkpoint:getTuple', extra: { threadId, found: true } });
      return {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_id: deserializedCheckpoint.id,
          },
        },
        checkpoint: deserializedCheckpoint,
        metadata: deserializedMetadata,
        parentConfig: stored.parentCheckpointId
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_id: stored.parentCheckpointId,
              },
            }
          : undefined,
      };
    } catch {
      return undefined;
    }
  }

  // ----- list -----

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return;

    const dir = threadDir(this.dataDir, threadId);
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort().reverse();
    } catch {
      return;
    }

    const limit = options?.limit ?? 10;
    let count = 0;

    for (const file of files) {
      if (count >= limit) break;
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8');
        const stored: StoredCheckpoint = JSON.parse(raw);
        const deserializedCheckpoint = await this.serde.loadsTyped('json', stored.checkpoint) as Checkpoint;
        const deserializedMetadata = await this.serde.loadsTyped('json', stored.metadata) as CheckpointMetadata;
        yield {
          config: {
            configurable: {
              thread_id: threadId,
              checkpoint_id: deserializedCheckpoint.id,
            },
          },
          checkpoint: deserializedCheckpoint,
          metadata: deserializedMetadata,
          parentConfig: stored.parentCheckpointId
            ? {
                configurable: {
                  thread_id: threadId,
                  checkpoint_id: stored.parentCheckpointId,
                },
              }
            : undefined,
        };
        count++;
      } catch {
        // Skip corrupt files
      }
    }
  }

  // ----- put -----

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, string | number>,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string;
    if (!threadId) throw new Error('thread_id is required for checkpoint storage');

    const dir = threadDir(this.dataDir, threadId);
    await fs.mkdir(dir, { recursive: true });

    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;
    const filePath = checkpointPath(this.dataDir, threadId, checkpoint.id);

    // Use serde to serialize so LangChain message objects (BaseMessage etc.)
    // retain their class identity through serialize → deserialize cycles.
    const [, serializedCheckpoint] = await this.serde.dumpsTyped(checkpoint);
    const [, serializedMetadata] = await this.serde.dumpsTyped(metadata);
    const checkpointStr = typeof serializedCheckpoint === 'string'
      ? serializedCheckpoint
      : new TextDecoder().decode(serializedCheckpoint);
    const metadataStr = typeof serializedMetadata === 'string'
      ? serializedMetadata
      : new TextDecoder().decode(serializedMetadata);

    const stored: StoredCheckpoint = {
      checkpoint: checkpointStr,
      metadata: metadataStr,
      parentCheckpointId,
    };

    await fs.writeFile(filePath, JSON.stringify(stored), 'utf-8');

    logger.debug({ threadId, checkpointId: checkpoint.id }, 'Checkpoint saved');
    logStateTransition(logger, { node: 'checkpoint:put', extra: { threadId, checkpointId: checkpoint.id } });

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  // ----- putWrites -----

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointId = config.configurable?.checkpoint_id as string;
    if (!threadId || !checkpointId) return;

    const dir = writesDir(this.dataDir, threadId, checkpointId);
    await fs.mkdir(dir, { recursive: true });

    // Serialize writes through serde to preserve BaseMessage class identity
    const serializedWrites = await Promise.all(
      writes.map(async ([channel, value]) => {
        const [, serialized] = await this.serde.dumpsTyped(value);
        const serializedStr = typeof serialized === 'string'
          ? serialized
          : new TextDecoder().decode(serialized);
        return [channel, serializedStr] as PendingWrite;
      }),
    );

    const filePath = path.join(dir, `${taskId}.json`);
    await fs.writeFile(filePath, JSON.stringify(serializedWrites), 'utf-8');
    logStateTransition(logger, { node: 'checkpoint:putWrites', extra: { threadId, checkpointId, writeCount: writes.length } });
  }

  // ----- deleteThread -----

  async deleteThread(threadId: string): Promise<void> {
    const cpDir = threadDir(this.dataDir, threadId);
    const wDir = path.join(this.dataDir, 'writes', threadId);

    await fs.rm(cpDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(wDir, { recursive: true, force: true }).catch(() => {});
    logger.info({ threadId }, 'checkpoint thread deleted');
  }
}
