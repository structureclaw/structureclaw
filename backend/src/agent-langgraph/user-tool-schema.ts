/**
 * Zod schema for user-defined tool YAML files.
 * Users place tool.yaml + tool.js in ~/.structureclaw/tools/<name>/
 */
import { z } from 'zod';

export const userToolYamlSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({
    zh: z.string().min(1),
    en: z.string().min(1),
  }),
  description: z.object({
    zh: z.string().min(1),
    en: z.string().min(1),
  }),
  category: z.enum(['engineering', 'interaction', 'session', 'workspace', 'memory']),
  risk: z.enum(['low', 'workspace-read', 'workspace-write', 'destructive']),
  parameters: z.record(z.string(), z.unknown()),
  defaultEnabled: z.boolean().optional().default(true),
});

export type UserToolYaml = z.infer<typeof userToolYamlSchema>;

export interface UserToolLoadFailure {
  toolDir: string;
  reason: 'missing_yaml' | 'missing_js' | 'invalid_yaml' | 'import_failed' | 'no_execute';
  detail?: string;
}
