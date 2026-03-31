import { z } from 'zod';

export const skillExecutionSchema = z.object({
  inferredType: z.string().optional(),
  draftPatch: z.record(z.unknown()).optional(),
  missingCritical: z.array(z.string()).optional(),
  missingOptional: z.array(z.string()).optional(),
  questions: z.array(z.object({
    paramKey: z.string(),
    label: z.string(),
    question: z.string(),
    unit: z.string().optional(),
    required: z.boolean(),
    critical: z.boolean(),
  })).optional(),
  defaultProposals: z.array(z.object({
    paramKey: z.string(),
    value: z.unknown(),
    reason: z.string(),
  })).optional(),
  stage: z.enum(['intent', 'model', 'loads', 'analysis', 'code_check', 'report']).optional(),
  supportLevel: z.enum(['supported', 'fallback', 'unsupported']).optional(),
  supportNote: z.string().optional(),
  skillId: z.string().optional(),
});

export type SkillExecutionPayload = z.infer<typeof skillExecutionSchema>;
