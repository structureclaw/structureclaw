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
import { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from '@langchain/langgraph';
import type { PendingWrite } from '@langchain/langgraph-checkpoint';
import { logger } from '../utils/logger.js';

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
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
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
        const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
        if (jsonFiles.length === 0) return undefined;
        targetFile = path.join(dir, jsonFiles[jsonFiles.length - 1]);
      } catch {
        return undefined;
      }
    }

    try {
      const raw = await fs.readFile(targetFile, 'utf-8');
      const stored: StoredCheckpoint = JSON.parse(raw);
      return {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_id: stored.checkpoint.id,
          },
        },
        checkpoint: stored.checkpoint,
        metadata: stored.metadata,
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
        yield {
          config: {
            configurable: {
              thread_id: threadId,
              checkpoint_id: stored.checkpoint.id,
            },
          },
          checkpoint: stored.checkpoint,
          metadata: stored.metadata,
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

    const stored: StoredCheckpoint = {
      checkpoint,
      metadata,
      parentCheckpointId,
    };

    await fs.writeFile(filePath, JSON.stringify(stored), 'utf-8');

    logger.debug({ threadId, checkpointId: checkpoint.id }, 'Checkpoint saved');

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

    const filePath = path.join(dir, `${taskId}.json`);
    await fs.writeFile(filePath, JSON.stringify(writes), 'utf-8');
  }

  // ----- deleteThread -----

  async deleteThread(threadId: string): Promise<void> {
    const cpDir = threadDir(this.dataDir, threadId);
    const wDir = path.join(this.dataDir, 'writes', threadId);

    await fs.rm(cpDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(wDir, { recursive: true, force: true }).catch(() => {});
  }
}
