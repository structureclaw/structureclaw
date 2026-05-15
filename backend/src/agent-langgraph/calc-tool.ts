/**
 * Engineering calculator tool: safe math expression evaluation via mathjs.
 *
 * Uses a locked-down mathjs instance that disables import/evaluate/parse/config
 * to prevent expression injection and global state manipulation.
 * The math instance and its overrides are created once at module load time
 * (intentional — process-wide lockdown ensures no circumvention).
 */
import { tool } from '@langchain/core/tools';
import { create, all } from 'mathjs';
import { z } from 'zod';

const MAX_EXPRESSION_LENGTH = 500;

const math = create(all);

// Save the safe evaluate reference BEFORE disabling it
const safeEvaluate = math.evaluate;

// Disable dangerous functions to prevent injection and state manipulation
math.import(
  {
    import: function () { throw new Error('Function import is disabled'); },
    createUnit: function () { throw new Error('Function createUnit is disabled'); },
    evaluate: function () { throw new Error('Function evaluate is disabled'); },
    parse: function () { throw new Error('Function parse is disabled'); },
    config: function () { throw new Error('Function config is disabled'); },
  },
  { override: true },
);

export function createCalculateTool() {
  return tool(
    async (input: { expression: string; unit?: string }) => {
      const { expression, unit } = input;

      if (!expression || expression.trim().length === 0) {
        return JSON.stringify({ success: false, error: 'Empty expression' });
      }
      if (expression.length > MAX_EXPRESSION_LENGTH) {
        return JSON.stringify({ success: false, error: `Expression exceeds ${MAX_EXPRESSION_LENGTH} character limit` });
      }

      try {
        // Pass empty scope to prevent state leakage between invocations
        const result = safeEvaluate(expression, {});

        if (result === null || typeof result === 'undefined') {
          return JSON.stringify({ success: false, error: 'Expression produced no result' });
        }

        // Convert mathjs result types to a finite number
        let numericResult: number;
        if (typeof result === 'number') {
          numericResult = result;
        } else if (typeof result === 'object' && typeof result.toNumber === 'function') {
          numericResult = result.toNumber();
        } else if (typeof result === 'object' && typeof result.valueOf === 'function') {
          const val = result.valueOf();
          if (typeof val !== 'number') {
            return JSON.stringify({ success: false, error: `Unsupported result value type: ${typeof val}`, expression });
          }
          numericResult = val;
        } else {
          return JSON.stringify({ success: false, error: `Unsupported result type: ${typeof result}`, expression });
        }

        // Reject Infinity and NaN — not useful for engineering calculations
        if (!Number.isFinite(numericResult)) {
          return JSON.stringify({ success: false, error: `Result is not a finite number: ${numericResult}`, expression });
        }

        const response: Record<string, unknown> = {
          success: true,
          result: numericResult,
          expression,
        };
        if (unit) {
          response.unit = unit;
        }
        return JSON.stringify(response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ success: false, error: msg, expression });
      }
    },
    {
      name: 'calculate',
      description:
        'Execute engineering math calculations with guaranteed precision. ' +
        'Supports arithmetic (+, -, *, /, ^, mod), trigonometric functions (sin, cos, tan, asin, acos, atan), ' +
        'logarithms (log, log10, exp), utilities (sqrt, abs, ceil, floor, round, max, min, pow), ' +
        'and constants (pi, e). The % operator is modulo (remainder). ' +
        'Does NOT rely on LLM text generation — results are deterministic.',
      schema: z.object({
        expression: z.string().describe('Math expression to evaluate, e.g. "sqrt(3^2 + 4^2)" or "20e3 * 6^2 / 8"'),
        unit: z.string().optional().describe('Optional unit label for display (e.g. "kN·m", "mm²"). Does not affect calculation.'),
      }),
    },
  );
}
