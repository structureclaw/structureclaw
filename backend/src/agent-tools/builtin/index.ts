import type { ToolManifest } from '../../agent-runtime/types.js';
import { CONVERT_MODEL_TOOL_MANIFEST } from './convert-model.js';
import { DRAFT_MODEL_TOOL_MANIFEST } from './draft-model.js';
import { GENERATE_REPORT_TOOL_MANIFEST } from './generate-report.js';
import { RUN_ANALYSIS_TOOL_MANIFEST } from './run-analysis.js';
import { RUN_CODE_CHECK_TOOL_MANIFEST } from './run-code-check.js';
import { UPDATE_MODEL_TOOL_MANIFEST } from './update-model.js';
import { VALIDATE_MODEL_TOOL_MANIFEST } from './validate-model.js';

export const BUILTIN_TOOL_MANIFESTS: ToolManifest[] = [
  DRAFT_MODEL_TOOL_MANIFEST,
  UPDATE_MODEL_TOOL_MANIFEST,
  CONVERT_MODEL_TOOL_MANIFEST,
  VALIDATE_MODEL_TOOL_MANIFEST,
  RUN_ANALYSIS_TOOL_MANIFEST,
  RUN_CODE_CHECK_TOOL_MANIFEST,
  GENERATE_REPORT_TOOL_MANIFEST,
];
