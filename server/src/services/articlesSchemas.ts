import { z } from 'zod';

const CoherenceWarningSchema = z.object({
  sourceArticleId: z.string().nullable().optional(),
  severity: z.enum(['warning', 'conflict']),
  description: z.string(),
});

const SuggestedLinkSchema = z.object({
  targetArticleTitle: z.string(),
  targetArticleId: z.string().nullable().optional(),
});

const TemporalAnchorSchema = z
  .object({ start: z.string(), end: z.string().optional() })
  .nullable()
  .optional();

const MentionSchema = z.object({
  title: z.string().min(1).max(500),
  templateType: z.enum(['general', 'character', 'location', 'faction', 'historical_event']).default('general'),
  summary: z.string().optional(),
});

export const GeneratedDraftContentSchema = z.object({
  description: z.string().optional(),
  introduction: z.string().optional(),
  chronologySection: z.string().optional(),
  childDescription: z.string().optional(),
  parentAppend: z.string().optional(),
  coherenceWarnings: z.array(CoherenceWarningSchema).optional().default([]),
  suggestedLinks: z.array(SuggestedLinkSchema).optional().default([]),
  temporalAnchor: TemporalAnchorSchema,
  retentionIssues: z
    .array(z.object({ description: z.string(), severity: z.enum(['warning', 'critical']) }))
    .optional()
    .default([]),
  mentions: z.array(MentionSchema).optional().default([]),
});

export type GeneratedDraftContent = z.infer<typeof GeneratedDraftContentSchema>;
