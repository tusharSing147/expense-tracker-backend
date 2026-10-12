import type { Request, Response } from 'express';
import type { Expense, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { formatDateOnly } from '../utils/dates';
import { toNumber } from '../utils/money';
import type {
  CreateExpenseInput,
  IdParams,
  ListExpensesQuery,
  UpdateExpenseInput,
} from '../validators/expense.validator';

interface ExpenseResponse {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toExpenseResponse(expense: Expense): ExpenseResponse {
  return {
    id: expense.id,
    title: expense.title,
    amount: toNumber(expense.amount),
    category: expense.category,
    date: formatDateOnly(expense.date),
    description: expense.description,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

function dateOnlyToDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export async function listExpenses(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const query = req.query as unknown as ListExpensesQuery;

  const where: Prisma.ExpenseWhereInput = {
    userId,
    date: {
      gte: query.startDate !== undefined ? dateOnlyToDate(query.startDate) : undefined,
      lte: query.endDate !== undefined ? dateOnlyToDate(query.endDate) : undefined,
    },
    category: query.category !== undefined ? { in: query.category } : undefined,
    amount: { gte: query.minAmount, lte: query.maxAmount },
    title:
      query.search !== undefined ? { contains: query.search, mode: 'insensitive' } : undefined,
  };

  const orderBy: Prisma.ExpenseOrderByWithRelationInput =
    query.sortBy === 'amount'
      ? { amount: query.order }
      : query.sortBy === 'createdAt'
        ? { createdAt: query.order }
        : { date: query.order };

  const [total, aggregate, rows] = await prisma.$transaction([
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.status(200).json({
    data: rows.map(toExpenseResponse),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
    totals: { sumAmount: toNumber(aggregate._sum.amount ?? 0) },
  });
}

export async function createExpense(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const input = req.body as CreateExpenseInput;
  const created = await prisma.expense.create({
    data: {
      userId,
      title: input.title,
      amount: input.amount,
      category: input.category,
      date: dateOnlyToDate(input.date),
      description: input.description ?? null,
    },
  });

  res.status(201).json(toExpenseResponse(created));
}

export async function getExpense(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const { id } = req.params as IdParams;
  const expense = await prisma.expense.findFirst({ where: { id, userId } });
  if (expense === null) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Expense not found' } });
    return;
  }

  res.status(200).json(toExpenseResponse(expense));
}

export async function updateExpense(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const { id } = req.params as IdParams;
  const input = req.body as UpdateExpenseInput;

  const existing = await prisma.expense.findFirst({ where: { id, userId }, select: { id: true } });
  if (existing === null) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Expense not found' } });
    return;
  }

  const data: Prisma.ExpenseUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.category !== undefined) data.category = input.category;
  if (input.date !== undefined) data.date = dateOnlyToDate(input.date);
  if (input.description !== undefined) data.description = input.description;

  const updated = await prisma.expense.update({ where: { id }, data });
  res.status(200).json(toExpenseResponse(updated));
}

export async function deleteExpense(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const { id } = req.params as IdParams;
  const { count } = await prisma.expense.deleteMany({ where: { id, userId } });
  if (count === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Expense not found' } });
    return;
  }

  res.status(204).end();
}
