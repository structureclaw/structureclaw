/**
 * File-aware agent tools: analyze_file
 *
 * analyze_file inspects an uploaded file at a given path and extracts
 * meaningful content depending on the file type:
 *   - CSV / text: returns parsed rows / raw content
 *   - Excel (.xlsx/.xls): returns headers + first N rows per sheet
 *   - PDF: extracts text via pdf-parse (if installed)
 *   - Image (png/jpg/…): returns base64-encoded data URI for multimodal LLM
 *   - DXF: extracts LINE, TEXT, DIMENSION entities as structural hints
 *   - Other binary: returns metadata + extension hint
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fsp from 'fs/promises';
import path from 'path';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentConfigurable } from './configurable.js';
import { runtimeBaseDir } from '../config/index.js';

const UPLOAD_DIR = path.join(runtimeBaseDir, '.uploads');
const MAX_READ_BYTES = 10 * 1024 * 1024; // 10 MB cap for analysis
const CSV_MAX_ROWS = 100;
const EXCEL_MAX_ROWS = 50;
const IMAGE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB base64 cap

const TEXT_EXTS = new Set(['.txt', '.md', '.log', '.tcl', '.py', '.json', '.yaml', '.yml', '.csv', '.tsv']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const EXCEL_EXTS = new Set(['.xlsx', '.xls']);

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true only when candidatePath is exactly root or a strict descendant. */
export function isPathWithinRoot(candidatePath: string, root: string): boolean {
  const c = path.normalize(candidatePath);
  const r = path.normalize(root);
  return c === r || c.startsWith(r + path.sep);
}

/** Resolve an uploaded file path safely inside UPLOAD_DIR or workspaceRoot.
 *
 * Relative paths (e.g. ".uploads/<conversationId>/<file>") are resolved
 * against runtimeBaseDir so the leading ".uploads/" segment is preserved
 * and the final path lands inside UPLOAD_DIR correctly.
 */
export function resolveUploadPath(
  relPath: string,
  workspaceRoot: string | undefined,
): string {
  const runtimeDir = path.resolve(UPLOAD_DIR, '..');
  // Absolute paths: allow only inside UPLOAD_DIR or workspaceRoot
  if (path.isAbsolute(relPath)) {
    const absNorm = path.normalize(relPath);
    if (isPathWithinRoot(absNorm, UPLOAD_DIR) || (workspaceRoot && isPathWithinRoot(absNorm, workspaceRoot))) {
      return absNorm;
    }
    throw new Error('Access denied: path outside allowed directories');
  }
  // Relative: resolve under runtimeBaseDir so ".uploads/<conv>/<file>" resolves correctly
  const uploadResolved = path.resolve(runtimeDir, relPath);
  if (isPathWithinRoot(uploadResolved, UPLOAD_DIR)) {
    return uploadResolved;
  }
  if (workspaceRoot) {
    const wsResolved = path.resolve(workspaceRoot, relPath);
    if (isPathWithinRoot(wsResolved, workspaceRoot)) {
      return wsResolved;
    }
  }
  throw new Error('Access denied: path traversal blocked');
}

/** Parse CSV text into rows (header + data). */
function parseCsv(text: string, maxRows: number): { headers: string[]; rows: string[][] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if ((ch === ',' || ch === '\t') && !inQuote) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1, maxRows + 1).map(splitLine);
  return { headers, rows };
}

/** Extract DXF entities as structural hints. */
function parseDxf(text: string): {
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  texts: string[];
  entityCount: number;
} {
  const result = {
    lines: [] as Array<{ x1: number; y1: number; x2: number; y2: number }>,
    texts: [] as string[],
    entityCount: 0,
  };

  const dxfLines = text.split(/\r?\n/).map((l) => l.trim());
  let i = 0;
  while (i < dxfLines.length) {
    if (dxfLines[i] === '0' && dxfLines[i + 1] === 'LINE') {
      result.entityCount += 1;
      // Read next group codes until next entity
      const entity: Record<string, string> = {};
      i += 2;
      while (i < dxfLines.length && !(dxfLines[i] === '0')) {
        const code = dxfLines[i];
        const value = dxfLines[i + 1] || '';
        entity[code] = value;
        i += 2;
      }
      if (result.lines.length < 200) {
        result.lines.push({
          x1: parseFloat(entity['10'] || '0'),
          y1: parseFloat(entity['20'] || '0'),
          x2: parseFloat(entity['11'] || '0'),
          y2: parseFloat(entity['21'] || '0'),
        });
      }
      continue;
    }
    if (dxfLines[i] === '0' && (dxfLines[i + 1] === 'TEXT' || dxfLines[i + 1] === 'MTEXT')) {
      result.entityCount += 1;
      i += 2;
      while (i < dxfLines.length && !(dxfLines[i] === '0')) {
        const code = dxfLines[i];
        const value = dxfLines[i + 1] || '';
        // Group code 1 = text string
        if ((code === '1' || code === '3') && value.trim() && result.texts.length < 100) {
          result.texts.push(value.trim());
        }
        i += 2;
      }
      continue;
    }
    if (dxfLines[i] === '0') {
      result.entityCount += 1;
    }
    i += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// analyze_file tool
// ---------------------------------------------------------------------------

export function createAnalyzeFileTool() {
  return tool(
    async (
      input: { filePath: string; maxRows?: number },
      config: LangGraphRunnableConfig,
    ) => {
      const workspaceRoot = (config.configurable as Partial<AgentConfigurable>)?.workspaceRoot;

      let resolvedPath: string;
      try {
        resolvedPath = resolveUploadPath(input.filePath, workspaceRoot);
      } catch (err) {
        return JSON.stringify({ success: false, error: String(err) });
      }

      let stat: Awaited<ReturnType<typeof fsp.stat>>;
      try {
        stat = await fsp.stat(resolvedPath);
      } catch {
        return JSON.stringify({ success: false, error: 'FILE_NOT_FOUND', filePath: input.filePath });
      }

      if (!stat.isFile()) {
        return JSON.stringify({ success: false, error: 'NOT_A_FILE', filePath: input.filePath });
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const size = stat.size;

      // ── Image ────────────────────────────────────────────────────────────
      if (IMAGE_EXTS.has(ext)) {
        if (size > IMAGE_MAX_BYTES) {
          return JSON.stringify({
            success: true,
            type: 'image',
            ext,
            size,
            note: 'Image too large for base64 encoding (> 4 MB). Consider resizing before analysis.',
          });
        }
        const buf = await fsp.readFile(resolvedPath);
        const mime = IMAGE_MIME[ext] ?? 'image/png';
        const base64 = buf.toString('base64');
        return JSON.stringify({
          success: true,
          type: 'image',
          ext,
          size,
          mimeType: mime,
          base64DataUri: `data:${mime};base64,${base64}`,
          note: 'Pass base64DataUri to a multimodal LLM vision call to extract structural information.',
        });
      }

      if (size > MAX_READ_BYTES) {
        return JSON.stringify({
          success: false,
          error: 'FILE_TOO_LARGE',
          size,
          note: `File exceeds ${MAX_READ_BYTES / 1024 / 1024} MB analysis limit.`,
        });
      }

      // ── PDF ──────────────────────────────────────────────────────────────
      if (ext === '.pdf') {
        try {
          // Dynamic import so the server still starts if pdf-parse is not installed
          const pdfParse = await import('pdf-parse').then((m) => m.default ?? m);
          const buf = await fsp.readFile(resolvedPath);
          const data = await pdfParse(buf);
          return JSON.stringify({
            success: true,
            type: 'pdf',
            ext,
            size,
            pageCount: data.numpages,
            text: data.text.slice(0, 8000),
            truncated: data.text.length > 8000,
          });
        } catch (err) {
          const msg = String(err);
          if (msg.includes('Cannot find module')) {
            return JSON.stringify({
              success: false,
              type: 'pdf',
              error: 'PDF_PARSE_NOT_INSTALLED',
              note: 'Install pdf-parse: npm install pdf-parse',
            });
          }
          return JSON.stringify({ success: false, type: 'pdf', error: msg });
        }
      }

      // ── Excel ────────────────────────────────────────────────────────────
      if (EXCEL_EXTS.has(ext)) {
        try {
          const XLSX = await import('xlsx').then((m) => m.default ?? m);
          const buf = await fsp.readFile(resolvedPath);
          const workbook = XLSX.read(buf, { type: 'buffer' });
          const maxRows = Math.min(input.maxRows ?? EXCEL_MAX_ROWS, 200);
          const sheets: Record<string, { headers: string[]; rows: unknown[][] }> = {};
          for (const sheetName of workbook.SheetNames) {
            const ws = workbook.Sheets[sheetName];
            const jsonData: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
            const headers = (jsonData[0] as unknown[] ?? []).map(String);
            const rows = jsonData.slice(1, maxRows + 1).map((row) =>
              (row as unknown[]).map((cell) => (cell === null || cell === undefined ? '' : cell)),
            );
            sheets[sheetName] = { headers, rows };
          }
          return JSON.stringify({ success: true, type: 'excel', ext, size, sheets });
        } catch (err) {
          const msg = String(err);
          if (msg.includes('Cannot find module')) {
            return JSON.stringify({
              success: false,
              type: 'excel',
              error: 'XLSX_NOT_INSTALLED',
              note: 'Install xlsx: npm install xlsx',
            });
          }
          return JSON.stringify({ success: false, type: 'excel', error: msg });
        }
      }

      // ── CSV / TSV / plain text ────────────────────────────────────────────
      if (ext === '.csv' || ext === '.tsv' || TEXT_EXTS.has(ext)) {
        const buf = await fsp.readFile(resolvedPath);
        const text = buf.toString('utf-8');

        if (ext === '.csv' || ext === '.tsv') {
          const maxRows = Math.min(input.maxRows ?? CSV_MAX_ROWS, 500);
          const allLines = text.split(/\r?\n/);
          const parsed = parseCsv(text, maxRows);
          return JSON.stringify({
            success: true,
            type: 'csv',
            ext,
            size,
            totalLines: allLines.length,
            headers: parsed.headers,
            rows: parsed.rows,
            truncated: allLines.length - 1 > maxRows,
          });
        }

        // Plain text
        const preview = text.slice(0, 8000);
        return JSON.stringify({
          success: true,
          type: 'text',
          ext,
          size,
          content: preview,
          truncated: text.length > 8000,
        });
      }

      // ── DXF ──────────────────────────────────────────────────────────────
      if (ext === '.dxf') {
        const buf = await fsp.readFile(resolvedPath);
        const text = buf.toString('utf-8');
        const dxfData = parseDxf(text);
        return JSON.stringify({
          success: true,
          type: 'dxf',
          ext,
          size,
          entityCount: dxfData.entityCount,
          lineCount: dxfData.lines.length,
          lines: dxfData.lines.slice(0, 50),
          texts: dxfData.texts.slice(0, 50),
          note: 'Line entities represent structural members (beams, columns). TEXT/MTEXT contains dimensions and labels.',
        });
      }

      // ── Unknown binary ───────────────────────────────────────────────────
      return JSON.stringify({
        success: true,
        type: 'binary',
        ext,
        size,
        note: `Binary file of type ${ext}. No parser available. Check if the correct file was uploaded.`,
      });
    },
    {
      name: 'analyze_file',
      description:
        'Analyze an uploaded file and extract its content. ' +
        'Supports CSV/TSV (structured rows), Excel (.xlsx/.xls, multi-sheet), ' +
        'PDF (text extraction), images (base64 for multimodal LLM), ' +
        'DXF/CAD (structural entity extraction), and plain text. ' +
        'filePath may be a relative path under .uploads/<conversationId>/ or an absolute path inside the upload directory.',
      schema: z.object({
        filePath: z.string().describe('Path to the uploaded file (relPath from upload response, or absolute path)'),
        maxRows: z.number().int().min(1).max(500).optional().describe('Max rows to return for CSV/Excel (default 50-100)'),
      }),
    },
  );
}
