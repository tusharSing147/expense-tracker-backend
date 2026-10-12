import { z } from 'zod';

export const summaryQuerySchema = z
  .object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
