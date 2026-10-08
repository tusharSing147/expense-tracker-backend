import { z } from 'zod';
import { CATEGORIES } from '../config/constants';

const limitSchema = z
  .number()
  .positive()
  .max(9999999999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: 'Limit must have at most 2 decimal places',
  });

const monthSchema = z.number().int().min(1).max(12);

const yearSchema = z.number().int().min(2000).max(2100);

export const createBudgetSchema = z
  .object({
    category: z.enum(CATEGORIES),
    limit: limitSchema,
    month: monthSchema,
    year: yearSchema,
  })
  .strict();

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({ limit: limitSchema }).strict();

export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

export const listBudgetsQuerySchema = z
  .object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();

export type ListBudgetsQuery = z.infer<typeof listBudgetsQuerySchema>;

export const budgetIdParamsSchema = z.object({ id: z.uuid() }).strict();

export const copyBudgetsSchema = z
  .object({
    fromMonth: monthSchema,
    fromYear: yearSchema,
    toMonth: monthSchema,
    toYear: yearSchema,
  })
  .strict();

export type CopyBudgetsInput = z.infer<typeof copyBudgetsSchema>;
