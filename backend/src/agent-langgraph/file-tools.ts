/**
 * File-aware agent tools: analyze_file
 *
 * analyze_file inspects an uploaded file at a given path and extracts
 * meaningful content depending on the file type:
 *   - CSV / text / AT2: returns parsed rows / raw content
 *   - Excel (.xlsx/.xls): returns headers + first N rows per sheet
 *   - PDF: extracts text via pdf-parse (if installed)
 *   - Image (png/jpg/...): returns metadata/base64 for the configured vision parser
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

const TEXT_EXTS = new Set(['.txt', '.at2', '.md', '.log', '.tcl', '.py', '.json', '.yaml', '.yml', '.csv', '.tsv']);
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

type AnalyzeFileResult = Record<string, unknown>;

interface AnalyzeUploadedFileOptions {
  includeImageData?: boolean;
  mode?: 'preview' | 'full';
}

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
export function parseCsv(text: string, maxRows: number): { headers: string[]; rows: string[][] } {
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
const DXF_LINE_PREVIEW_LIMIT = 500;
const DXF_TEXT_PREVIEW_LIMIT = 200;

export function parseDxf(text: string): {
  lines: Array<{ x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; layer: string }>;
  texts: string[];
  entityCount: number;
  lineEntityCount: number;
  textEntityCount: number;
  invalidLineCount: number;
  insertionUnits: { code: number; name: string; metersPerUnit: number | null } | null;
} {
  const insertionUnitDefinitions: Record<number, { name: string; metersPerUnit: number | null }> = {
    0: { name: 'unitless', metersPerUnit: null },
    1: { name: 'inches', metersPerUnit: 0.0254 },
    2: { name: 'feet', metersPerUnit: 0.3048 },
    4: { name: 'millimeters', metersPerUnit: 0.001 },
    5: { name: 'centimeters', metersPerUnit: 0.01 },
    6: { name: 'meters', metersPerUnit: 1 },
    7: { name: 'kilometers', metersPerUnit: 1000 },
    10: { name: 'yards', metersPerUnit: 0.9144 },
    14: { name: 'decimeters', metersPerUnit: 0.1 },
    15: { name: 'decameters', metersPerUnit: 10 },
    16: { name: 'hectometers', metersPerUnit: 100 },
    21: { name: 'us-survey-feet', metersPerUnit: 1200 / 3937 },
  };
  const result = {
    lines: [] as Array<{ x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; layer: string }>,
    texts: [] as string[],
    entityCount: 0,
    lineEntityCount: 0,
    textEntityCount: 0,
    invalidLineCount: 0,
    insertionUnits: null as { code: number; name: string; metersPerUnit: number | null } | null,
  };

  const dxfLines = text.split(/\r?\n/).map((l) => l.trim());
  for (let pairIndex = 0; pairIndex + 3 < dxfLines.length; pairIndex += 2) {
    if (dxfLines[pairIndex] !== '9' || dxfLines[pairIndex + 1] !== '$INSUNITS') continue;
    if (dxfLines[pairIndex + 2] !== '70') continue;
    const code = Number.parseInt(dxfLines[pairIndex + 3], 10);
    if (!Number.isFinite(code)) continue;
    const definition = insertionUnitDefinitions[code] || { name: `code-${code}`, metersPerUnit: null };
    result.insertionUnits = { code, ...definition };
    break;
  }
  let i = 0;
  while (i < dxfLines.length) {
    if (dxfLines[i] === '0' && dxfLines[i + 1] === 'LINE') {
      result.entityCount += 1;
      result.lineEntityCount += 1;
      // Read next group codes until next entity
      const entity: Record<string, string> = {};
      i += 2;
      while (i < dxfLines.length && !(dxfLines[i] === '0')) {
        const code = dxfLines[i];
        const value = dxfLines[i + 1] || '';
        entity[code] = value;
        i += 2;
      }
      const requiredCoordinates = ['10', '20', '11', '21'].map((code) => {
        const raw = entity[code];
        return raw !== undefined && raw.trim() !== '' ? Number(raw) : Number.NaN;
      });
      const optionalZCoordinates = ['30', '31'].map((code) => (
        entity[code] === undefined
          ? 0
          : entity[code].trim() !== '' ? Number(entity[code]) : Number.NaN
      ));
      const coordinates = [...requiredCoordinates, ...optionalZCoordinates];
      if (requiredCoordinates.some((value) => !Number.isFinite(value))
        || optionalZCoordinates.some((value) => !Number.isFinite(value))) {
        result.invalidLineCount += 1;
      } else if (result.lines.length < DXF_LINE_PREVIEW_LIMIT) {
        const [x1, y1, x2, y2, z1, z2] = coordinates;
        result.lines.push({ x1, y1, z1, x2, y2, z2, layer: entity['8'] || '0' });
      }
      continue;
    }
    if (dxfLines[i] === '0' && (dxfLines[i + 1] === 'TEXT' || dxfLines[i + 1] === 'MTEXT')) {
      result.entityCount += 1;
      result.textEntityCount += 1;
      i += 2;
      while (i < dxfLines.length && !(dxfLines[i] === '0')) {
        const code = dxfLines[i];
        const value = dxfLines[i + 1] || '';
        // Group code 1 = text string
        if ((code === '1' || code === '3') && value.trim() && result.texts.length < DXF_TEXT_PREVIEW_LIMIT) {
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

export async function analyzeUploadedFile(
  filePath: string,
  workspaceRoot: string | undefined,
  maxRows?: number,
  options: AnalyzeUploadedFileOptions = {},
): Promise<AnalyzeFileResult> {
  let resolvedPath: string;
  try {
    resolvedPath = resolveUploadPath(filePath, workspaceRoot);
  } catch (err) {
    return { success: false, error: String(err) };
  }

  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(resolvedPath);
  } catch {
    return { success: false, error: 'FILE_NOT_FOUND', filePath };
  }

  if (!stat.isFile()) {
    return { success: false, error: 'NOT_A_FILE', filePath };
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const size = stat.size;

  // ── Image ────────────────────────────────────────────────────────────
  if (IMAGE_EXTS.has(ext)) {
    if (size > IMAGE_MAX_BYTES) {
      return {
        success: true,
        type: 'image',
        ext,
        size,
        note: 'Image too large for base64 encoding (> 4 MB). Consider resizing before analysis.',
      };
    }
    const buf = await fsp.readFile(resolvedPath);
    const mime = IMAGE_MIME[ext] ?? 'image/png';
    const base64 = buf.toString('base64');
    const imageResult: AnalyzeFileResult = {
      success: true,
      type: 'image',
      ext,
      size,
      mimeType: mime,
      note: 'Image binary is available for the configured vision parser. The main agent should use the resulting text summary, not pass base64DataUri to the standard model.',
    };
    if (options.includeImageData) {
      imageResult.base64DataUri = `data:${mime};base64,${base64}`;
    }
    return imageResult;
  }

  if (size > MAX_READ_BYTES) {
    return {
      success: false,
      error: 'FILE_TOO_LARGE',
      size,
      note: `File exceeds ${MAX_READ_BYTES / 1024 / 1024} MB analysis limit.`,
    };
  }

  // ── PDF ──────────────────────────────────────────────────────────────
  if (ext === '.pdf') {
    try {
      // Dynamic import so the server still starts if pdf-parse is not installed
      // Handle both ES module default export and CommonJS module format
      const mod = await import('pdf-parse');
      const pdfParse = 'default' in mod ? mod.default : mod;
      const buf = await fsp.readFile(resolvedPath);
      const data = await (pdfParse as (buf: Buffer) => Promise<{ numpages: number; text: string }>)(buf);
      return {
        success: true,
        type: 'pdf',
        ext,
        size,
        pageCount: data.numpages,
        text: data.text.slice(0, 8000),
        truncated: data.text.length > 8000,
      };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Cannot find module')) {
        return {
          success: false,
          type: 'pdf',
          error: 'PDF_PARSE_NOT_INSTALLED',
          note: 'Install pdf-parse: npm install pdf-parse',
        };
      }
      return { success: false, type: 'pdf', error: msg };
    }
  }

  // ── Excel ────────────────────────────────────────────────────────────
  if (EXCEL_EXTS.has(ext)) {
    try {
      const XLSX = await import('xlsx').then((m) => m.default ?? m);
      const buf = await fsp.readFile(resolvedPath);
      const workbook = XLSX.read(buf, { type: 'buffer' });
      const sheets: Record<string, { headers: string[]; rows: unknown[][] }> = {};
      for (const sheetName of workbook.SheetNames) {
        const ws = workbook.Sheets[sheetName];
        const jsonData: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
        const rowLimit = options.mode === 'full'
          ? Math.max(jsonData.length - 1, 0)
          : Math.min(maxRows ?? EXCEL_MAX_ROWS, 200);
        const headers = (jsonData[0] as unknown[] ?? []).map(String);
        const rows = jsonData.slice(1, rowLimit + 1).map((row) =>
          (row as unknown[]).map((cell) => (cell === null || cell === undefined ? '' : cell)),
        );
        sheets[sheetName] = { headers, rows };
      }
      return { success: true, type: 'excel', ext, size, sheets };
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Cannot find module')) {
        return {
          success: false,
          type: 'excel',
          error: 'XLSX_NOT_INSTALLED',
          note: 'Install xlsx: npm install xlsx',
        };
      }
      return { success: false, type: 'excel', error: msg };
    }
  }

  // ── CSV / TSV / AT2 / plain text ───────────────────────────────────────
  if (ext === '.csv' || ext === '.tsv' || TEXT_EXTS.has(ext)) {
    const buf = await fsp.readFile(resolvedPath);
    const text = buf.toString('utf-8');

    if (ext === '.csv' || ext === '.tsv') {
      const allLines = text.split(/\r?\n/);
      const rowLimit = options.mode === 'full'
        ? Math.max(allLines.filter((line) => line.trim()).length - 1, 0)
        : Math.min(maxRows ?? CSV_MAX_ROWS, 500);
      const parsed = parseCsv(text, rowLimit);
      return {
        success: true,
        type: 'csv',
        ext,
        size,
        totalLines: allLines.length,
        headers: parsed.headers,
        rows: parsed.rows,
        truncated: allLines.length - 1 > rowLimit,
      };
    }

    // Plain text
    const content = options.mode === 'full' ? text : text.slice(0, 8000);
    return {
      success: true,
      type: 'text',
      ext,
      size,
      content,
      truncated: options.mode === 'full' ? false : text.length > 8000,
    };
  }

  // ── DXF ──────────────────────────────────────────────────────────────
  if (ext === '.dxf') {
    const buf = await fsp.readFile(resolvedPath);
    const text = buf.toString('utf-8');
    const dxfData = parseDxf(text);
    return {
      success: true,
      type: 'dxf',
      ext,
      size,
      entityCount: dxfData.entityCount,
      lineCount: dxfData.lineEntityCount,
      textCount: dxfData.textEntityCount,
      invalidLineCount: dxfData.invalidLineCount,
      lines: dxfData.lines,
      texts: dxfData.texts,
      linesTruncated: dxfData.lineEntityCount - dxfData.invalidLineCount > dxfData.lines.length,
      textsTruncated: dxfData.textEntityCount > dxfData.texts.length,
      coordinateFrame: 'source-dxf',
      insertionUnits: dxfData.insertionUnits,
      note: 'LINE coordinates remain in the source DXF frame. Do not treat source Y as StructureClaw global Y or Z until the drawing view is confirmed. Use declared insertionUnits when available; ask when units, plan/elevation/3D axis mapping, or truncated entities are ambiguous.',
    };
  }

  // ── Unknown binary ───────────────────────────────────────────────────
  return {
    success: true,
    type: 'binary',
    ext,
    size,
    note: `Binary file of type ${ext}. No parser available. Check if the correct file was uploaded.`,
  };
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
      const configurable = config.configurable as Partial<AgentConfigurable>;
      const workspaceRoot = configurable?.workspaceRoot;
      if (Array.isArray(configurable?.fileAccessAllowlist)) {
        let requestedPath: string;
        let allowedPaths: string[];
        try {
          requestedPath = resolveUploadPath(input.filePath, workspaceRoot);
          allowedPaths = configurable.fileAccessAllowlist.map(
            (filePath) => resolveUploadPath(filePath, workspaceRoot),
          );
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (!allowedPaths.includes(requestedPath)) {
          return JSON.stringify({
            success: false,
            error: 'Access denied: analyze_file is restricted to the attachments supplied for this run',
          });
        }
      }
      return JSON.stringify(await analyzeUploadedFile(input.filePath, workspaceRoot, input.maxRows));
    },
    {
      name: 'analyze_file',
      description:
        'Analyze an uploaded file and extract its content. ' +
        'Supports CSV/TSV (structured rows), AT2/TXT ground-motion text, Excel (.xlsx/.xls, multi-sheet), ' +
        'PDF (text extraction), images (metadata/base64 for the configured vision parser), ' +
        'DXF/CAD (structural entity extraction), and plain text. ' +
        'filePath may be a relative path under .uploads/<conversationId>/ or an absolute path inside the upload directory.',
      schema: z.object({
        filePath: z.string().describe('Path to the uploaded file (relPath from upload response, or absolute path)'),
        maxRows: z.number().int().min(1).max(500).optional().describe('Max rows to return for CSV/Excel (default 50-100)'),
      }),
    },
  );
}
