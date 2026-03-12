import { z } from 'zod';

export const skillExecutionSchema = z.object({
  detectedScenario: z.string().optional(),
  inferredType: z.enum(['beam', 'truss', 'portal-frame', 'double-span-beam', 'unknown']).optional(),
  draftPatch: z.object({
    inferredType: z.enum(['beam', 'truss', 'portal-frame', 'double-span-beam', 'unknown']).optional(),
    lengthM: z.number().finite().optional(),
    spanLengthM: z.number().finite().optional(),
    heightM: z.number().finite().optional(),
    supportType: z.enum(['cantilever', 'simply-supported', 'fixed-fixed', 'fixed-pinned']).optional(),
    loadKN: z.number().finite().optional(),
    loadType: z.enum(['point', 'distributed']).optional(),
    loadPosition: z.enum(['end', 'midspan', 'full-span', 'top-nodes', 'middle-joint', 'free-joint']).optional(),
  }).optional(),
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
});

export type SkillExecutionPayload = z.infer<typeof skillExecutionSchema>;
