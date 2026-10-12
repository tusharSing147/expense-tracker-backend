import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { currentYearMonth, lastNMonths } from '../src/utils/dates';
import { bearer, registerUser, type AuthFixture } from './helpers/auth';
import { resetDb } from './helpers/db';

const BASE = '/api/dashboard/summary';

interface CategoryRow {
  category: string;
  spent: number;
  budget: number | null;
  remaining: number | null;
  percentUsed: number | null;
  status: 'ok' | 'warning' | 'exceeded' | null;
}

interface RecentExpense {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  description: string | null;
  createdAt: string;
}

interface TrendPoint {
  month: number;
  year: number;
  total: number;
}

interface SummaryBody {
  period: { month: number; year: number };
  totalSpent: number;
  totalBudget: number;
  remainingBudget: number;
  overBudget: boolean;
  categories: CategoryRow[];
  recentExpenses: RecentExpense[];
  monthlyTrend: TrendPoint[];
}

interface SeedExpenseOptions {
  amount?: number;
  category?: string;
  date?: Date;
  createdAt?: Date;
  title?: string;
  description?: string;
}

async function seedExpense(
  userId: string,
  options: SeedExpenseOptions = {},
): Promise<{ id: string }> {
  return prisma.expense.create({
    data: {
      userId,
      title: options.title ?? 'Test expense',
      amount: options.amount ?? 100,
      category: options.category ?? 'Food',
      date: options.date ?? new Date(Date.UTC(2026, 5, 15)),
      description: options.description ?? null,
      createdAt: options.createdAt,
    },
    select: { id: true },
  });
}

async function seedBudget(
  userId: string,
  options: { category: string; limit: number; month: number; year: number },
): Promise<{ id: string }> {
  return prisma.budget.create({
    data: { userId, ...options },
    select: { id: true },
  });
}

function summaryBody(res: request.Response): SummaryBody {
  return res.body as SummaryBody;
}

let userA: AuthFixture;
let userB: AuthFixture;

beforeEach(async () => {
  await resetDb();
  userA = await registerUser(app, { name: 'User A' });
  userB = await registerUser(app, { name: 'User B' });
});

async function getSummary(
  accessToken: string,
  query = '',
): Promise<request.Response> {
  return request(app).get(`${BASE}${query}`).set(bearer(accessToken));
}

describe('GET /api/dashboard/summary', () => {
  it('returns zeros for an empty month', async () => {
    const res = await getSummary(userA.accessToken, '?month=6&year=2026');
    expect(res.status).toBe(200);
    const body = summaryBody(res);
    expect(body.period).toEqual({ month: 6, year: 2026 });
    expect(body.totalSpent).toBe(0);
    expect(body.totalBudget).toBe(0);
    expect(body.remainingBudget).toBe(0);
    expect(body.overBudget).toBe(false);
    expect(body.categories).toEqual([]);
    expect(body.recentExpenses).toEqual([]);
    expect(body.monthlyTrend).toHaveLength(6);
    const expectedMonths = lastNMonths(6, 2026, 6);
    expect(body.monthlyTrend.map((p) => p.total)).toEqual([0, 0, 0, 0, 0, 0]);
    body.monthlyTrend.forEach((point, index) => {
      expect(point.month).toBe(expectedMonths[index].month);
      expect(point.year).toBe(expectedMonths[index].year);
    });
    expect(body.monthlyTrend[0]).toEqual({
      month: expectedMonths[0].month,
      year: expectedMonths[0].year,
      total: 0,
    });
    expect(body.monthlyTrend[5]).toEqual({ month: 6, year: 2026, total: 0 });
  });

  it('computes a hand-calculated month with category rows and user isolation', async () => {
    await seedExpense(userA.userId, { amount: 300, category: 'Food', date: new Date(Date.UTC(2026, 5, 5)) });
    await seedExpense(userA.userId, { amount: 200, category: 'Food', date: new Date(Date.UTC(2026, 5, 10)) });
    await seedExpense(userA.userId, { amount: 500, category: 'Transport', date: new Date(Date.UTC(2026, 5, 12)) });
    await seedExpense(userA.userId, { amount: 1200, category: 'Rent', date: new Date(Date.UTC(2026, 5, 1)) });
    await seedExpense(userA.userId, { amount: 999, category: 'Food', date: new Date(Date.UTC(2026, 4, 31)) });
    await seedExpense(userB.userId, { amount: 7777, category: 'Shopping', date: new Date(Date.UTC(2026, 5, 15)) });
    await seedBudget(userA.userId, { category: 'Food', limit: 800, month: 6, year: 2026 });
    await seedBudget(userA.userId, { category: 'Rent', limit: 1200, month: 6, year: 2026 });
    await seedBudget(userB.userId, { category: 'Shopping', limit: 500, month: 6, year: 2026 });

    const res = await getSummary(userA.accessToken, '?month=6&year=2026');
    expect(res.status).toBe(200);
    const body = summaryBody(res);
    expect(body.period).toEqual({ month: 6, year: 2026 });
    expect(body.totalSpent).toBe(2200);
    expect(body.totalBudget).toBe(2000);
    expect(body.remainingBudget).toBe(300);
    expect(body.overBudget).toBe(false);
    expect(body.categories).toEqual([
      { category: 'Food', spent: 500, budget: 800, remaining: 300, percentUsed: 62.5, status: 'ok' },
      { category: 'Rent', spent: 1200, budget: 1200, remaining: 0, percentUsed: 100, status: 'warning' },
      { category: 'Transport', spent: 500, budget: null, remaining: null, percentUsed: null, status: null },
    ]);
    expect(body.recentExpenses).toHaveLength(4);
    for (const expense of body.recentExpenses) {
      expect(expense.amount).not.toBe(999);
      expect(expense.amount).not.toBe(7777);
      expect(expense.category).not.toBe('Shopping');
      expect(typeof expense.amount).toBe('number');
    }
    expect(body.monthlyTrend[5]).toEqual({ month: 6, year: 2026, total: 2200 });
  });

  it('flags warning at 87.5% while a large unbudgeted spend keeps overBudget false', async () => {
    await seedExpense(userA.userId, { amount: 700, category: 'Food', date: new Date(Date.UTC(2026, 5, 5)) });
    await seedExpense(userA.userId, { amount: 10000, category: 'Transport', date: new Date(Date.UTC(2026, 5, 6)) });
    await seedBudget(userA.userId, { category: 'Food', limit: 800, month: 6, year: 2026 });

    const res = await getSummary(userA.accessToken, '?month=6&year=2026');
    expect(res.status).toBe(200);
    const body = summaryBody(res);
    expect(body.totalSpent).toBe(10700);
    expect(body.totalBudget).toBe(800);
    expect(body.remainingBudget).toBe(100);
    expect(body.overBudget).toBe(false);
    expect(body.categories).toEqual([
      { category: 'Food', spent: 700, budget: 800, remaining: 100, percentUsed: 87.5, status: 'warning' },
      { category: 'Transport', spent: 10000, budget: null, remaining: null, percentUsed: null, status: null },
    ]);
  });

  it('flags exceeded and overBudget when budgeted spend exceeds the limit', async () => {
    await seedExpense(userA.userId, { amount: 900, category: 'Food', date: new Date(Date.UTC(2026, 5, 5)) });
    await seedBudget(userA.userId, { category: 'Food', limit: 800, month: 6, year: 2026 });

    const res = await getSummary(userA.accessToken, '?month=6&year=2026');
    expect(res.status).toBe(200);
    const body = summaryBody(res);
    expect(body.totalBudget).toBe(800);
    expect(body.remainingBudget).toBe(-100);
    expect(body.overBudget).toBe(true);
    expect(body.categories).toEqual([
      { category: 'Food', spent: 900, budget: 800, remaining: -100, percentUsed: 112.5, status: 'exceeded' },
    ]);
  });

  it('returns the 5 newest in-month expenses with numeric amounts and YYYY-MM-DD dates', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const row = await seedExpense(userA.userId, {
        amount: 10 * (i + 1),
        title: `Expense ${i}`,
        description: `desc ${i}`,
        date: new Date(Date.UTC(2026, 5, i + 1)),
        createdAt: new Date(Date.UTC(2026, 5, 20, i)),
      });
      ids.push(row.id);
    }

    const res = await getSummary(userA.accessToken, '?month=6&year=2026');
    expect(res.status).toBe(200);
    const body = summaryBody(res);
    expect(body.recentExpenses).toHaveLength(5);
    expect(body.recentExpenses.map((e) => e.id)).toEqual(ids.slice(2).reverse());
    expect(body.recentExpenses.map((e) => e.amount)).toEqual([70, 60, 50, 40, 30]);
    expect(body.recentExpenses.map((e) => e.date)).toEqual([
      '2026-06-07',
      '2026-06-06',
      '2026-06-05',
      '2026-06-04',
      '2026-06-03',
    ]);
    for (const expense of body.recentExpenses) {
      expect(typeof expense.amount).toBe('number');
      expect(expense.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof expense.title).toBe('string');
      expect(typeof expense.description).toBe('string');
      expect(typeof expense.createdAt).toBe('string');
    }
    expect(body.recentExpenses[0].description).toBe('desc 6');
  });

  it('computes the 6-month trend in ascending order with only in-scope months counted', async () => {
    await seedExpense(userA.userId, { amount: 120, category: 'Food', date: new Date(Date.UTC(2026, 0, 10)) });
    await seedExpense(userA.userId, { amount: 80, category: 'Food', date: new Date(Date.UTC(2026, 0, 20)) });
    await seedExpense(userA.userId, { amount: 300, category: 'Transport', date: new Date(Date.UTC(2026, 2, 15)) });
    await seedExpense(userA.userId, { amount: 150, category: 'Rent', date: new Date(Date.UTC(2026, 5, 5)) });
    await seedExpense(userA.userId, { amount: 50, category: 'Food', date: new Date(Date.UTC(2026, 5, 20)) });
    await seedExpense(userB.userId, { amount: 99999, category: 'Food', date: new Date(Date.UTC(2026, 0, 11)) });

    const res = await getSummary(userA.accessToken, '?month=6&year=2026');
    expect(res.status).toBe(200);
    const body = summaryBody(res);
    expect(body.monthlyTrend).toHaveLength(6);
    expect(body.monthlyTrend.map((p) => p.total)).toEqual([200, 0, 300, 0, 0, 200]);
    const expectedMonths = lastNMonths(6, 2026, 6);
    body.monthlyTrend.forEach((point, index) => {
      expect(point.month).toBe(expectedMonths[index].month);
      expect(point.year).toBe(expectedMonths[index].year);
    });
    expect(body.monthlyTrend.map((p) => p.month)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(body.monthlyTrend[5]).toEqual({ month: 6, year: 2026, total: 200 });
  });

  it('defaults the period to the current year and month', async () => {
    const res = await getSummary(userA.accessToken);
    expect(res.status).toBe(200);
    const body = summaryBody(res);
    const current = currentYearMonth();
    expect(body.period).toEqual({ month: current.month, year: current.year });
  });

  it('rejects invalid query parameters with 400 VALIDATION_ERROR', async () => {
    for (const query of ['?month=13&year=2026', '?year=2026&foo=1', '?year=1999']) {
      const res = await getSummary(userA.accessToken, query);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed' },
      });
    }
  });

  it('rejects a missing access token with 401', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});
