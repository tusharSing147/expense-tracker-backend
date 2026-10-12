import { z } from 'zod';
import { CATEGORIES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../config/constants';

const amountSchema = z.coerce.number().superRefine((value, ctx) => {
  if (!Number.isFinite(value)) {
    ctx.addIssue({ code: 'custom', message: 'Must be a valid number' });
    return;
  }
  if (value <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Must be greater than 0' });
    return;
  }
  if (value > 9999999999.99) {
    ctx.addIssue({ code: 'custom', message: 'Must be at most 9999999999.99' });
    return;
  }
  const cents = value * 100;
  if (Math.abs(cents - Math.round(cents)) >= 1e-6) {
    ctx.addIssue({ code: 'custom', message: 'At most 2 decimal places are allowed' });
  }
});

const dateOnlySchema = z.string().superRefine((value, ctx) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    ctx.addIssue({ code: 'custom', message: 'Must be a date in YYYY-MM-DD format' });
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    ctx.addIssue({ code: 'custom', message: 'Must be a real calendar date' });
    return;
  }
  const now = new Date();
  const limit = Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate());
  if (parsed.getTime() > limit) {
    ctx.addIssue({ code: 'custom', message: 'Cannot be more than 1 year in the future' });
  }
});

const titleSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(500).nullish();

const categoryFilterSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) {
      return;
    }
    const entries = typeof value === 'string' ? value.split(',') : value;
    for (const entry of entries) {
      if (!(CATEGORIES as readonly string[]).includes(entry)) {
        ctx.addIssue({ code: 'custom', message: `Unknown category: ${entry}` });
      }
    }
  })
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'string' ? value.split(',') : value;
  });

export const createExpenseSchema = z
  .object({
    title: titleSchema,
    amount: amountSchema,
    category: z.enum(CATEGORIES),
    date: dateOnlySchema,
    description: descriptionSchema,
  })
  .strict();

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    title: titleSchema.optional(),
    amount: amountSchema.optional(),
    category: z.enum(CATEGORIES).optional(),
    date: dateOnlySchema.optional(),
    description: descriptionSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.title === undefined &&
      data.amount === undefined &&
      data.category === undefined &&
      data.date === undefined &&
      data.description === undefined
    ) {
      ctx.addIssue({ code: 'custom', message: 'At least one field must be provided' });
    }
  });

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    category: categoryFilterSchema,
    minAmount: z.coerce.number().min(0).optional(),
    maxAmount: z.coerce.number().min(0).optional(),
    search: z.string().trim().max(100).optional(),
    sortBy: z.enum(['date', 'amount', 'createdAt']).default('date'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.startDate !== undefined &&
      data.endDate !== undefined &&
      data.startDate > data.endDate
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'startDate must be on or before endDate',
      });
    }
    if (
      data.minAmount !== undefined &&
      data.maxAmount !== undefined &&
      data.minAmount > data.maxAmount
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['minAmount'],
        message: 'minAmount must be less than or equal to maxAmount',
      });
    }
  });

export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const idParamsSchema = z.object({ id: z.uuid() }).strict();

export type IdParams = z.infer<typeof idParamsSchema>;
