/**
 * Load user-defined tools from the workspace tools directory.
 * Scans <workspaceRoot>/tools/<name>/tool.yaml + tool.js, validates,
 * and wraps them into AgentToolDefinition objects for the tool registry.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { parse as parseYaml } from 'yaml';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { userToolYamlSchema, type UserToolLoadFailure } from './user-tool-schema.js';
import type { AgentToolDefinition, AgentToolFactoryDeps } from './tool-registry.js';
import { logger } from '../utils/logger.js';

type UserToolModule = {
  execute: (params: Record<string, unknown>, context: { workspaceRoot: string }) => Promise<unknown>;
};

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  // Convert a JSON Schema object to a Zod object schema.
  // Supports: string, number, integer, boolean, array, object (recursive).
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);

  function propToZod(prop: Record<string, unknown>): z.ZodType {
    switch (prop.type) {
      case 'string':
        return z.string();
      case 'integer':
        return z.number().int();
      case 'number':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'array': {
        const items = prop.items as Record<string, unknown> | undefined;
        const itemSchema = items ? propToZod(items) : z.unknown();
        return z.array(itemSchema);
      }
      case 'object': {
        const subProps = (prop.properties ?? {}) as Record<string, Record<string, unknown>>;
        const subRequired = new Set((prop.required ?? []) as string[]);
        if (Object.keys(subProps).length === 0) {
          return z.record(z.string(), z.unknown());
        }
        const shape: Record<string, z.ZodType> = {};
        for (const [key, subProp] of Object.entries(subProps)) {
          let field = propToZod(subProp);
          if (!subRequired.has(key)) {
            field = field.optional();
          }
          shape[key] = field;
        }
        return z.object(shape);
      }
      default:
        return z.unknown();
    }
  }

  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field = propToZod(prop);
    if (!required.has(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }

  return z.object(shape);
}

export async function loadUserTools(
  workspaceToolRoot: string,
): Promise<{ tools: AgentToolDefinition[]; failures: UserToolLoadFailure[] }> {
  const tools: AgentToolDefinition[] = [];
  const failures: UserToolLoadFailure[] = [];

  if (!existsSync(workspaceToolRoot)) {
    return { tools, failures };
  }

  const entries = readdirSync(workspaceToolRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const toolDir = path.join(workspaceToolRoot, entry.name);

    // 1. Validate tool.yaml
    const yamlPath = path.join(toolDir, 'tool.yaml');
    if (!existsSync(yamlPath)) {
      failures.push({ toolDir, reason: 'missing_yaml' });
      continue;
    }

    let parsed: z.infer<typeof userToolYamlSchema>;
    try {
      const raw = parseYaml(readFileSync(yamlPath, 'utf8'));
      parsed = userToolYamlSchema.parse(raw);
    } catch (err) {
      failures.push({ toolDir, reason: 'invalid_yaml', detail: err instanceof Error ? err.message : String(err) });
      continue;
    }

    // 2. Import tool.js
    const jsPath = path.join(toolDir, 'tool.js');
    if (!existsSync(jsPath)) {
      failures.push({ toolDir, reason: 'missing_js' });
      continue;
    }

    let module: UserToolModule;
    try {
      const fileUrl = pathToFileURL(jsPath).href;
      const imported = await import(fileUrl);
      // Support both ESM (imported.execute) and CJS (imported.default.execute) exports
      const resolved = imported.default ?? imported;
      if (typeof resolved.execute !== 'function') {
        failures.push({ toolDir, reason: 'no_execute' });
        continue;
      }
      module = resolved as UserToolModule;
    } catch (err) {
      failures.push({ toolDir, reason: 'import_failed', detail: err instanceof Error ? err.message : String(err) });
      continue;
    }

    // 3. Wrap into AgentToolDefinition
    const zodSchema = jsonSchemaToZod(parsed.parameters);
    const toolId = parsed.id;
    const executeFn = module.execute;

    tools.push({
      id: toolId,
      category: parsed.category,
      risk: parsed.risk,
      defaultEnabled: parsed.defaultEnabled,
      displayName: parsed.displayName,
      description: parsed.description,
      create: (deps: AgentToolFactoryDeps) => {
        return new DynamicStructuredTool({
          name: toolId,
          description: parsed.description.en,
          schema: zodSchema,
          func: async (input) => {
            try {
              const result = await executeFn(input as Record<string, unknown>, {
                workspaceRoot: deps.workspaceRoot ?? '',
              });
              return typeof result === 'string' ? result : JSON.stringify(result ?? null);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(`User tool '${toolId}' execution failed: ${msg}`);
              return JSON.stringify({ error: msg });
            }
          },
        });
      },
    });
  }

  return { tools, failures };
}
