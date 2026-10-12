import { z } from 'zod';
import { currentYearMonth } from '../utils/dates';

export const monthlyReportQuerySchema = z
  .object({
    month: z.coerce.number().int().min(1).max(12).default(() => currentYearMonth().month),
    year: z.coerce.number().int().min(2000).max(2100).default(() => currentYearMonth().year),
    format: z.enum(['json', 'csv', 'xlsx']).default('json'),
  })
  .strict();

export type MonthlyReportQuery = z.infer<typeof monthlyReportQuerySchema>;

export const yearlyReportQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).default(() => currentYearMonth().year),
    format: z.enum(['json', 'csv', 'xlsx']).default('json'),
  })
  .strict();

export type YearlyReportQuery = z.infer<typeof yearlyReportQuerySchema>;
