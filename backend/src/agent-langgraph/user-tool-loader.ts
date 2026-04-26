/**
 * Load user-defined tools from the workspace tools directory.
 * Scans <workspaceRoot>/tools/<name>/tool.yaml + tool.js, validates,
 * and wraps them into AgentToolDefinition objects for the tool registry.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { userToolYamlSchema, type UserToolLoadFailure } from './user-tool-schema.js';
import type { AgentToolDefinition, AgentToolFactoryDeps } from './tool-registry.js';
import { logger } from '../utils/logger.js';

type UserToolModule = {
  execute: (params: Record<string, unknown>, context: { workspaceRoot: string }) => Promise<unknown>;
};

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  // Convert a simple JSON Schema object to a Zod object schema.
  // Supports: string, number, boolean, array, object (1 level deep).
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    switch (prop.type) {
      case 'string':
        field = z.string();
        break;
      case 'number':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        field = z.array(z.unknown());
        break;
      case 'object':
        field = z.record(z.unknown());
        break;
      default:
        field = z.unknown();
    }
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
      const imported = await import(`file://${jsPath}`);
      if (typeof imported.execute !== 'function') {
        failures.push({ toolDir, reason: 'no_execute' });
        continue;
      }
      module = imported as UserToolModule;
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
              return typeof result === 'string' ? result : JSON.stringify(result);
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
