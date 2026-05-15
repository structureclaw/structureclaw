/**
 * Engineering calculator tool: safe math expression evaluation via mathjs.
 *
 * Uses a locked-down mathjs instance that disables import/evaluate/parse
 * to prevent expression injection attacks.
 */
import { tool } from '@langchain/core/tools';
import { create, all } from 'mathjs';
import { z } from 'zod';

const MAX_EXPRESSION_LENGTH = 500;

const math = create(all);

// Save the safe evaluate reference BEFORE disabling it
const safeEvaluate = math.evaluate;

// Disable dangerous functions to prevent injection
math.import(
  {
    import: function () { throw new Error('Function import is disabled'); },
    createUnit: function () { throw new Error('Function createUnit is disabled'); },
    evaluate: function () { throw new Error('Function evaluate is disabled'); },
    parse: function () { throw new Error('Function parse is disabled'); },
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
        const result = safeEvaluate(expression);

        if (typeof result === 'undefined') {
          return JSON.stringify({ success: false, error: 'Expression produced no result' });
        }

        // Convert mathjs result types to plain number
        let numericResult: number;
        if (typeof result === 'number') {
          numericResult = result;
        } else if (typeof result === 'object' && typeof result.toNumber === 'function') {
          numericResult = result.toNumber();
        } else if (typeof result === 'object' && typeof result.valueOf === 'function') {
          numericResult = result.valueOf() as number;
        } else {
          return JSON.stringify({ success: false, error: `Unsupported result type: ${typeof result}` });
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
        'Supports arithmetic (+, -, *, /, ^, %), trigonometric functions (sin, cos, tan, asin, acos, atan), ' +
        'logarithms (log, log10, exp), utilities (sqrt, abs, ceil, floor, round, max, min, pow), ' +
        'and constants (pi, e). Does NOT rely on LLM text generation — results are deterministic.',
      schema: z.object({
        expression: z.string().describe('Math expression to evaluate, e.g. "sqrt(3^2 + 4^2)" or "20e3 * 6^2 / 8"'),
        unit: z.string().optional().describe('Optional unit label for display (e.g. "kN·m", "mm²"). Does not affect calculation.'),
      }),
    },
  );
}
