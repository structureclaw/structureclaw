import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentConfigurable } from './configurable.js';
import { resolveUploadPath } from './file-tools.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.agent-workspace']);
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const IMAGE_MAX_READ_BYTES = 4 * 1024 * 1024;
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};
const MAX_SEARCH_BYTES = 512 * 1024;
const MAX_GREP_MATCHES = 1000;
const MAX_GLOB_MATCHES = 5000;
const MAX_COLLECTED_FILES = 5000;
const MAX_SCANNED_ENTRIES = 50000;
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
  if (isAllowedFile(filePath)) {
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  throw new Error(`File extension denied: ${ext || '(none)'}`);
}

function isAllowedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
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

interface CollectFilesStats {
  skippedDirs: number;
  skippedEntries: number;
  scannedEntries: number;
  truncated: boolean;
}

interface CollectFilesOptions {
  maxMatches: number;
  maxScannedEntries: number;
}

function createCollectFilesStats(): CollectFilesStats {
  return {
    skippedDirs: 0,
    skippedEntries: 0,
    scannedEntries: 0,
    truncated: false,
  };
}

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

async function collectFiles(
  root: string,
  dir: string,
  depth: number,
  pattern: RegExp,
  result: string[],
  stats: CollectFilesStats,
  options: CollectFilesOptions,
): Promise<void> {
  if (stats.truncated) return;
  if (depth > 10) {
    stats.skippedDirs += 1;
    return;
  }
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    stats.skippedDirs += 1;
    return;
  }
  for (const entry of entries) {
    if (stats.truncated) break;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    stats.scannedEntries += 1;
    if (stats.scannedEntries > options.maxScannedEntries) {
      stats.truncated = true;
      break;
    }
    if (entry.isSymbolicLink()) {
      stats.skippedEntries += 1;
      continue;
    }
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await collectFiles(root, full, depth + 1, pattern, result, stats, options);
    } else if (entry.isFile() && pattern.test(rel)) {
      result.push(rel);
      if (result.length >= options.maxMatches) {
        stats.truncated = true;
        break;
      }
    } else if (!entry.isFile()) {
      stats.skippedEntries += 1;
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
      const maxResults = Math.max(1, Math.min(input.maxResults ?? 100, 200));
      const offset = Math.max(input.offset ?? 0, 0);
      const regex = globToRegex(input.pattern ?? '*');
      const files: string[] = [];
      const stats = createCollectFilesStats();
      await collectFiles(root, searchRoot, 0, regex, files, stats, {
        maxMatches: MAX_GLOB_MATCHES,
        maxScannedEntries: MAX_SCANNED_ENTRIES,
      });
      files.sort();
      const sliced = files.slice(offset, offset + maxResults);
      return JSON.stringify({
        totalMatches: files.length,
        shownCount: sliced.length,
        offset,
        nextOffset: offset + maxResults < files.length ? offset + maxResults : null,
        truncated: stats.truncated,
        skippedDirs: stats.skippedDirs,
        skippedEntries: stats.skippedEntries,
        scannedEntries: stats.scannedEntries,
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

      // Resolve path: workspace first, fall back to UPLOAD_DIR for uploaded files
      let resolved: string;
      try {
        const candidate = safeResolve(root, input.filePath);
        await fs.stat(candidate);
        resolved = candidate;
      } catch {
        try {
          resolved = resolveUploadPath(input.filePath, root);
        } catch (err) {
          return JSON.stringify({ success: false, error: 'FILE_NOT_FOUND', message: String(err) });
        }
      }

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(resolved);
      } catch {
        return JSON.stringify({ success: false, error: 'FILE_NOT_FOUND', filePath: input.filePath });
      }

      const ext = path.extname(resolved).toLowerCase();

      // Image: return base64 for multimodal LLM
      if (IMAGE_EXTS.has(ext)) {
        if (stat.size > IMAGE_MAX_READ_BYTES) {
          return JSON.stringify({
            success: true,
            type: 'image',
            ext,
            size: stat.size,
            note: 'Image exceeds 4 MB base64 limit. Consider resizing before analysis.',
          });
        }
        const buf = await fs.readFile(resolved);
        const mime = IMAGE_MIME[ext] ?? 'image/png';
        return JSON.stringify({
          success: true,
          type: 'image',
          ext,
          size: stat.size,
          mimeType: mime,
          base64DataUri: `data:${mime};base64,${buf.toString('base64')}`,
          note: 'Pass base64DataUri to a multimodal LLM vision call to extract structural information.',
        });
      }

      if (stat.size > MAX_READ_BYTES) {
        return JSON.stringify({ success: false, error: 'FILE_TOO_LARGE', size: stat.size });
      }

      const buf = await fs.readFile(resolved);

      // Binary: return metadata without content
      if (isProbablyBinary(buf)) {
        return JSON.stringify({
          success: true,
          type: 'binary',
          ext,
          size: stat.size,
          note: `Binary file of type ${ext}. Use analyze_file for structured extraction (PDF, Excel, etc.).`,
        });
      }

      // Text: enforce extension allowlist to avoid leaking sensitive files
      if (!isAllowedFile(resolved)) {
        return JSON.stringify({
          success: true,
          type: 'text',
          ext,
          size: stat.size,
          note: `Text file of type ${ext}. Content withheld (extension not in read allowlist). Use analyze_file if extraction is needed.`,
        });
      }

      const content = buf.toString('utf-8');
      return JSON.stringify({ success: true, type: 'text', ext, path: input.filePath, content, size: stat.size });
    },
    {
      name: 'read_file',
      description:
        'Read a file from the workspace or uploaded file paths. Auto-detects file type: ' +
        'text files (allowed extensions) return content; images return base64DataUri for multimodal LLM; ' +
        'binary files return metadata. For structured CSV/Excel/PDF extraction, prefer analyze_file.',
      schema: z.object({ filePath: z.string().describe('Relative workspace path or relPath from upload response') }),
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
      const collectStats = createCollectFilesStats();
      await collectFiles(root, root, 0, regex, files, collectStats, {
        maxMatches: MAX_COLLECTED_FILES,
        maxScannedEntries: MAX_SCANNED_ENTRIES,
      });
      const matches: Array<{ path: string; line: number; preview: string }> = [];
      const offset = Math.max(input.offset ?? 0, 0);
      const maxResults = Math.max(1, Math.min(input.maxResults ?? 50, 100));
      const needle = input.query.toLowerCase();
      let skippedFiles = 0;
      for (const rel of files.sort()) {
        if (matches.length >= MAX_GREP_MATCHES) break;
        const full = safeResolve(root, rel);
        if (!isAllowedFile(full)) {
          skippedFiles += 1;
          continue;
        }
        let stat;
        try {
          stat = await fs.lstat(full);
        } catch {
          skippedFiles += 1;
          continue;
        }
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_SEARCH_BYTES) {
          skippedFiles += 1;
          continue;
        }
        let content: string;
        try {
          const buffer = await fs.readFile(full);
          if (isProbablyBinary(buffer)) {
            skippedFiles += 1;
            continue;
          }
          content = buffer.toString('utf-8');
        } catch {
          skippedFiles += 1;
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (matches.length >= MAX_GREP_MATCHES) break;
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
        skippedFiles,
        truncated: collectStats.truncated || matches.length >= MAX_GREP_MATCHES,
        scannedEntries: collectStats.scannedEntries,
        skippedDirs: collectStats.skippedDirs,
        skippedEntries: collectStats.skippedEntries,
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
