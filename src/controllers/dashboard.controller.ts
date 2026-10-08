import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { currentYearMonth, formatDateOnly, lastNMonths, monthStartEnd } from '../utils/dates';
import { computeBudgetStatus, round1, toNumber } from '../utils/money';
import type { SummaryQuery } from '../validators/dashboard.validator';

interface CategoryRow {
  category: string;
  spent: number;
  budget: number | null;
  remaining: number | null;
  percentUsed: number | null;
  status: 'ok' | 'warning' | 'exceeded' | null;
}

function toCategoryRow(category: string, spent: number, limit: number | null): CategoryRow {
  if (limit === null) {
    return { category, spent, budget: null, remaining: null, percentUsed: null, status: null };
  }
  const rawPercent = (spent / limit) * 100;
  return {
    category,
    spent,
    budget: limit,
    remaining: limit - spent,
    percentUsed: round1(rawPercent),
    status: computeBudgetStatus(rawPercent),
  };
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const query = req.query as SummaryQuery;
  const current = currentYearMonth();
  const month = query.month ?? current.month;
  const year = query.year ?? current.year;
  const ms = monthStartEnd(year, month);

  const [totalAgg, budgetRows, budgetAgg, spentGroups, recentRows] = await Promise.all([
    prisma.expense.aggregate({
      where: { userId, date: { gte: ms.start, lt: ms.end } },
      _sum: { amount: true },
    }),
    prisma.budget.findMany({ where: { userId, month, year }, orderBy: { category: 'asc' } }),
    prisma.budget.aggregate({ where: { userId, month, year }, _sum: { limit: true } }),
    prisma.expense.groupBy({
      by: ['category'],
      where: { userId, date: { gte: ms.start, lt: ms.end } },
      _sum: { amount: true },
    }),
    prisma.expense.findMany({
      where: { userId, date: { gte: ms.start, lt: ms.end } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  const totalSpent = toNumber(totalAgg._sum.amount ?? 0);
  const totalBudget = toNumber(budgetAgg._sum.limit ?? 0);

  const budgetByCategory = new Map<string, number>();
  for (const row of budgetRows) {
    budgetByCategory.set(row.category, toNumber(row.limit));
  }
  const spentByCategory = new Map<string, number>();
  for (const row of spentGroups) {
    spentByCategory.set(row.category, toNumber(row._sum.amount ?? 0));
  }

  const categoryNames = [
    ...new Set([...budgetByCategory.keys(), ...spentByCategory.keys()]),
  ].sort();
  const categories = categoryNames.map((name) =>
    toCategoryRow(name, spentByCategory.get(name) ?? 0, budgetByCategory.get(name) ?? null),
  );

  const budgetedSpent = categories.reduce(
    (sum, row) => (row.budget !== null ? sum + row.spent : sum),
    0,
  );
  const remainingBudget = totalBudget - budgetedSpent;

  const recentExpenses = recentRows.map((expense) => ({
    id: expense.id,
    title: expense.title,
    amount: toNumber(expense.amount),
    category: expense.category,
    date: formatDateOnly(expense.date),
    description: expense.description,
    createdAt: expense.createdAt,
  }));

  const monthlyTrend = await Promise.all(
    lastNMonths(6, year, month).map(async ({ year: trendYear, month: trendMonth }) => {
      const range = monthStartEnd(trendYear, trendMonth);
      const agg = await prisma.expense.aggregate({
        where: { userId, date: { gte: range.start, lt: range.end } },
        _sum: { amount: true },
      });
      return { month: trendMonth, year: trendYear, total: toNumber(agg._sum.amount ?? 0) };
    }),
  );

  res.status(200).json({
    period: { month, year },
    totalSpent,
    totalBudget,
    remainingBudget,
    overBudget: remainingBudget < 0,
    categories,
    recentExpenses,
    monthlyTrend,
  });
}
