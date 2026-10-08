import type { Request, Response } from 'express';
import type { Budget } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { currentYearMonth, monthStartEnd } from '../utils/dates';
import { computeBudgetStatus, round1, toNumber } from '../utils/money';
import type {
  CopyBudgetsInput,
  CreateBudgetInput,
  ListBudgetsQuery,
  UpdateBudgetInput,
} from '../validators/budget.validator';

type BudgetRow = Pick<Budget, 'id' | 'category' | 'limit' | 'month' | 'year'>;

type BudgetResponse = {
  id: string;
  category: string;
  limit: number;
  month: number;
  year: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: 'ok' | 'warning' | 'exceeded';
};

function toBudgetResponse(b: BudgetRow, spent: number): BudgetResponse {
  const limit = toNumber(b.limit);
  return {
    id: b.id,
    category: b.category,
    limit,
    month: b.month,
    year: b.year,
    spent,
    remaining: limit - spent,
    percentUsed: spent === 0 ? 0 : round1((spent / limit) * 100),
    status: computeBudgetStatus((spent / limit) * 100),
  };
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
}

function notFound(res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Budget not found' } });
}

function budgetExists(res: Response): void {
  res.status(409).json({
    error: { code: 'BUDGET_EXISTS', message: 'Budget already exists for this category and month' },
  });
}

async function spentInMonth(userId: string, category: string, year: number, month: number): Promise<number> {
  const { start, end } = monthStartEnd(year, month);
  const agg = await prisma.expense.aggregate({
    where: { userId, category, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  return toNumber(agg._sum.amount ?? 0);
}

export async function listBudgets(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    unauthorized(res);
    return;
  }

  const query = req.query as ListBudgetsQuery;
  const current = currentYearMonth();
  const month = query.month ?? current.month;
  const year = query.year ?? current.year;

  const budgets = await prisma.budget.findMany({
    where: { userId, month, year },
    orderBy: { category: 'asc' },
  });

  const { start, end } = monthStartEnd(year, month);
  const grouped = await prisma.expense.groupBy({
    by: ['category'],
    where: { userId, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  const spentByCategory = new Map<string, number>(
    grouped.map((g) => [g.category, toNumber(g._sum.amount ?? 0)]),
  );

  res.status(200).json(
    budgets.map((b) => toBudgetResponse(b, spentByCategory.get(b.category) ?? 0)),
  );
}

export async function createBudget(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    unauthorized(res);
    return;
  }
  const input = req.body as CreateBudgetInput;

  const duplicate = await prisma.budget.findFirst({
    where: { userId, category: input.category, month: input.month, year: input.year },
    select: { id: true },
  });
  if (duplicate !== null) {
    budgetExists(res);
    return;
  }

  let created: Budget;
  try {
    created = await prisma.budget.create({
      data: {
        userId,
        category: input.category,
        limit: input.limit,
        month: input.month,
        year: input.year,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      budgetExists(res);
      return;
    }
    throw err;
  }

  const spent = await spentInMonth(userId, input.category, input.year, input.month);
  res.status(201).json(toBudgetResponse(created, spent));
}

export async function updateBudget(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    unauthorized(res);
    return;
  }
  const id = req.params.id as string;
  const input = req.body as UpdateBudgetInput;

  const existing = await prisma.budget.findFirst({ where: { id, userId } });
  if (existing === null) {
    notFound(res);
    return;
  }

  const updated = await prisma.budget.update({ where: { id }, data: { limit: input.limit } });
  const spent = await spentInMonth(userId, existing.category, existing.year, existing.month);
  res.status(200).json(toBudgetResponse(updated, spent));
}

export async function deleteBudget(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    unauthorized(res);
    return;
  }
  const id = req.params.id as string;

  const result = await prisma.budget.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    notFound(res);
    return;
  }
  res.status(204).end();
}

export async function copyBudgets(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    unauthorized(res);
    return;
  }
  const input = req.body as CopyBudgetsInput;

  const { copied, skipped } = await prisma.$transaction(async (tx) => {
    const source = await tx.budget.findMany({
      where: { userId, month: input.fromMonth, year: input.fromYear },
    });
    const existing = await tx.budget.findMany({
      where: { userId, month: input.toMonth, year: input.toYear },
      select: { category: true },
    });
    const existingSet = new Set(existing.map((b) => b.category));
    const toCreate = source.filter((b) => !existingSet.has(b.category));
    if (toCreate.length > 0) {
      await tx.budget.createMany({
        data: toCreate.map((b) => ({
          userId,
          category: b.category,
          limit: b.limit,
          month: input.toMonth,
          year: input.toYear,
        })),
      });
    }
    return { copied: toCreate.length, skipped: source.length - toCreate.length };
  });

  res.status(200).json({ copied, skipped });
}
