import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentConfigurable } from './configurable.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.agent-workspace']);
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_BYTES = 512 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.txt', '.json', '.csv', '.md', '.py', '.tcl', '.log', '.yaml', '.yml', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.prisma']);

function getWorkspaceRoot(config: LangGraphRunnableConfig): string {
  const root = (config.configurable as Partial<AgentConfigurable>)?.workspaceRoot || '';
  if (!root) throw new Error('workspaceRoot is not configured');
  return root;
}

export function safeResolve(workspaceRoot: string, requestedPath: string): string {
  const resolved = path.resolve(workspaceRoot, requestedPath);
  const root = path.resolve(workspaceRoot);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(prefix) && resolved !== root) {
    throw new Error(`Path traversal blocked: ${requestedPath} is outside workspace`);
  }
  return resolved;
}

function assertAllowedFile(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension denied: ${ext || '(none)'}`);
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expanded = escaped
    .replace(/\*\*\//g, '{{GLOBSTAR_SLASH}}')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR_SLASH\}\}/g, '(?:[^/]+/)*')
    .replace(/\{\{GLOBSTAR\}\}/g, '(?:[^/]+/)*[^/]+');
  return new RegExp(`^${expanded}$`, 'i');
}

async function collectFiles(root: string, dir: string, depth: number, pattern: RegExp, result: string[]): Promise<void> {
  if (depth > 10) return;
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await collectFiles(root, full, depth + 1, pattern, result);
    } else if (pattern.test(rel)) {
      result.push(rel);
    }
  }
}

// ---------------------------------------------------------------------------
// glob_files
// ---------------------------------------------------------------------------

export function createGlobFilesTool() {
  return tool(
    async (input: { pattern?: string; maxResults?: number; offset?: number; dirPath?: string }, config: LangGraphRunnableConfig) => {
      const root = getWorkspaceRoot(config);
      const searchRoot = input.dirPath ? safeResolve(root, input.dirPath) : root;
      const maxResults = Math.min(input.maxResults ?? 100, 200);
      const offset = Math.max(input.offset ?? 0, 0);
      const regex = globToRegex(input.pattern ?? '*');
      const files: string[] = [];
      await collectFiles(root, searchRoot, 0, regex, files);
      files.sort();
      const sliced = files.slice(offset, offset + maxResults);
      return JSON.stringify({
        totalMatches: files.length,
        shownCount: sliced.length,
        offset,
        nextOffset: offset + maxResults < files.length ? offset + maxResults : null,
        files: sliced,
      });
    },
    {
      name: 'glob_files',
      description: 'List workspace files matching a glob pattern with pagination. Skips .git, node_modules, .venv, __pycache__, and .agent-workspace.',
      schema: z.object({
        pattern: z.string().optional(),
        maxResults: z.number().optional(),
        offset: z.number().optional(),
        dirPath: z.string().optional(),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export function createReadFileTool() {
  return tool(
    async (input: { filePath: string }, config: LangGraphRunnableConfig) => {
      const root = getWorkspaceRoot(config);
      const resolved = safeResolve(root, input.filePath);
      assertAllowedFile(resolved);
      const stat = await fs.stat(resolved);
      if (stat.size > MAX_READ_BYTES) {
        return JSON.stringify({ success: false, error: 'FILE_TOO_LARGE', size: stat.size });
      }
      const content = await fs.readFile(resolved, 'utf-8');
      return JSON.stringify({ success: true, path: input.filePath, content, size: stat.size });
    },
    {
      name: 'read_file',
      description: 'Read a text file from the workspace. Paths are relative to workspaceRoot.',
      schema: z.object({ filePath: z.string() }),
    },
  );
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

export function createWriteFileTool() {
  return tool(
    async (input: { filePath: string; content: string }, config: LangGraphRunnableConfig) => {
      const root = getWorkspaceRoot(config);
      const resolved = safeResolve(root, input.filePath);
      assertAllowedFile(resolved);
      const size = Buffer.byteLength(input.content, 'utf-8');
      if (size > MAX_WRITE_BYTES) {
        return JSON.stringify({ success: false, error: 'FILE_TOO_LARGE', size });
      }
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, input.content, 'utf-8');
      return JSON.stringify({ success: true, path: input.filePath, bytesWritten: size });
    },
    {
      name: 'write_file',
      description: 'Write a text file inside the workspace. Creates parent directories.',
      schema: z.object({ filePath: z.string(), content: z.string() }),
    },
  );
}

// ---------------------------------------------------------------------------
// grep_files
// ---------------------------------------------------------------------------

export function createGrepFilesTool() {
  return tool(
    async (input: { query: string; pattern?: string; maxResults?: number; offset?: number }, config: LangGraphRunnableConfig) => {
      const root = getWorkspaceRoot(config);
      const regex = globToRegex(input.pattern ?? '**/*');
      const files: string[] = [];
      await collectFiles(root, root, 0, regex, files);
      const matches: Array<{ path: string; line: number; preview: string }> = [];
      const offset = Math.max(input.offset ?? 0, 0);
      const maxResults = Math.min(input.maxResults ?? 50, 100);
      const needle = input.query.toLowerCase();
      for (const rel of files.sort()) {
        const full = safeResolve(root, rel);
        assertAllowedFile(full);
        const stat = await fs.stat(full);
        if (stat.size > MAX_SEARCH_BYTES) continue;
        const lines = (await fs.readFile(full, 'utf-8')).split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (matches.length >= 1000) break;
          if (lines[index].toLowerCase().includes(needle)) {
            matches.push({ path: rel, line: index + 1, preview: lines[index].slice(0, 240) });
          }
        }
      }
      const sliced = matches.slice(offset, offset + maxResults);
      return JSON.stringify({
        totalMatches: matches.length,
        shownCount: sliced.length,
        offset,
        nextOffset: offset + maxResults < matches.length ? offset + maxResults : null,
        matches: sliced,
      });
    },
    {
      name: 'grep_files',
      description: 'Search workspace text files by content. Returns path, line, and preview with pagination.',
      schema: z.object({
        query: z.string(),
        pattern: z.string().optional(),
        maxResults: z.number().optional(),
        offset: z.number().optional(),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// replace_in_file
// ---------------------------------------------------------------------------

export function createReplaceInFileTool() {
  return tool(
    async (input: { filePath: string; oldText: string; newText: string; expectedReplacements?: number }, config: LangGraphRunnableConfig) => {
      const root = getWorkspaceRoot(config);
      const resolved = safeResolve(root, input.filePath);
      assertAllowedFile(resolved);
      const content = await fs.readFile(resolved, 'utf-8');
      const count = input.oldText.length === 0 ? 0 : content.split(input.oldText).length - 1;
      if (count === 0) return JSON.stringify({ success: false, error: 'TEXT_NOT_FOUND', replacements: 0 });
      if (input.expectedReplacements != null && count !== input.expectedReplacements) {
        return JSON.stringify({ success: false, error: 'REPLACEMENT_COUNT_MISMATCH', replacements: count });
      }
      const nextContent = content.split(input.oldText).join(input.newText);
      await fs.writeFile(resolved, nextContent, 'utf-8');
      return JSON.stringify({ success: true, path: input.filePath, replacements: count });
    },
    {
      name: 'replace_in_file',
      description: 'Perform exact text replacement in one workspace file.',
      schema: z.object({
        filePath: z.string(),
        oldText: z.string(),
        newText: z.string(),
        expectedReplacements: z.number().optional(),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// move_path
// ---------------------------------------------------------------------------

export function createMovePathTool() {
  return tool(
    async (input: { fromPath: string; toPath: string }, config: LangGraphRunnableConfig) => {
      const root = getWorkspaceRoot(config);
      const from = safeResolve(root, input.fromPath);
      const to = safeResolve(root, input.toPath);
      assertAllowedFile(from);
      assertAllowedFile(to);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return JSON.stringify({ success: true, fromPath: input.fromPath, toPath: input.toPath });
    },
    {
      name: 'move_path',
      description: 'Rename or move a workspace file.',
      schema: z.object({ fromPath: z.string(), toPath: z.string() }),
    },
  );
}

// ---------------------------------------------------------------------------
// delete_path
// ---------------------------------------------------------------------------

export function createDeletePathTool() {
  return tool(
    async (input: { filePath: string }, config: LangGraphRunnableConfig) => {
      const root = getWorkspaceRoot(config);
      const resolved = safeResolve(root, input.filePath);
      assertAllowedFile(resolved);
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) return JSON.stringify({ success: false, error: 'DELETE_ONLY_SUPPORTS_FILES' });
      await fs.unlink(resolved);
      return JSON.stringify({ success: true, path: input.filePath });
    },
    {
      name: 'delete_path',
      description: 'Delete a single workspace file. Directory deletion is not supported.',
      schema: z.object({ filePath: z.string() }),
    },
  );
}
