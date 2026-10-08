import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { MAX_REPORT_ROWS } from '../src/config/constants';
import { prisma } from '../src/config/prisma';
import { bearer, registerUser } from './helpers/auth';
import { resetDb } from './helpers/db';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

interface ExpenseJson {
  id: string;
  date: string;
  title: string;
  category: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

interface MonthlyJson {
  period: { month: number; year: number };
  expenses: ExpenseJson[];
  categoryTotals: { category: string; spent: number; budget: number | null; remaining: number | null }[];
  total: number;
}

interface YearlyJson {
  period: { year: number };
  monthlyTotals: { month: number; total: number; budget: number }[];
  categoryTotals: { category: string; total: number }[];
  grandTotal: number;
}

interface SeedExpenseInput {
  title?: string;
  amount?: number;
  category?: string;
  date: string;
  description?: string | null;
}

async function seedExpense(userId: string, input: SeedExpenseInput): Promise<void> {
  await prisma.expense.create({
    data: {
      userId,
      title: input.title ?? 'Expense',
      amount: input.amount ?? 10,
      category: input.category ?? 'Food',
      date: new Date(`${input.date}T00:00:00.000Z`),
      description: input.description ?? null,
    },
  });
}

async function seedBudget(
  userId: string,
  input: { category: string; limit: number; month: number; year: number },
): Promise<void> {
  await prisma.budget.create({ data: { userId, ...input } });
}

function sheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const found = workbook.getWorksheet(name);
  if (found === undefined) {
    throw new Error(`worksheet ${name} missing`);
  }
  return found;
}

const retryOnSharedDbRace = { retry: { count: 2, delay: 1000 } };

beforeEach(resetDb);
afterAll(resetDb);

describe('GET /api/reports/monthly', () => {
  it('returns month-scoped JSON with expenses, category totals, and total', retryOnSharedDbRace, async () => {
    const user = await registerUser(app);
    const other = await registerUser(app);

    await seedExpense(user.userId, {
      title: 'Groceries',
      amount: 42.5,
      category: 'Food',
      date: '2026-10-05',
      description: 'Weekly run',
    });
    await seedExpense(user.userId, { title: 'Bus pass', amount: 17.5, category: 'Transport', date: '2026-10-12' });
    await seedExpense(other.userId, { title: 'Other user spend', amount: 99, category: 'Food', date: '2026-10-05' });
    await seedBudget(user.userId, { category: 'Food', limit: 100, month: 10, year: 2026 });

    const res = await request(app)
      .get('/api/reports/monthly?month=10&year=2026')
      .set(bearer(user.accessToken));

    expect(res.status).toBe(200);
    const body = res.body as MonthlyJson;
    expect(body.period).toEqual({ month: 10, year: 2026 });
    expect(body.total).toBe(60);
    expect(body.expenses.map((expense) => expense.title)).toEqual(['Groceries', 'Bus pass']);
    expect(body.expenses[0]).toEqual({
      id: expect.any(String),
      date: '2026-10-05',
      title: 'Groceries',
      category: 'Food',
      amount: 42.5,
      description: 'Weekly run',
      createdAt: expect.any(String),
    });
    expect(body.expenses[1].description).toBeNull();
    expect(body.categoryTotals).toEqual([
      { category: 'Food', spent: 42.5, budget: 100, remaining: 57.5 },
      { category: 'Transport', spent: 17.5, budget: null, remaining: null },
    ]);
  });

  it('sends CSV with BOM, quoted cells, section headers, and a zero-padded filename', retryOnSharedDbRace, async () => {
    const user = await registerUser(app);
    await seedExpense(user.userId, { title: 'Coffee, bagel', amount: 5, category: 'Food', date: '2026-06-03' });
    await seedExpense(user.userId, { title: 'He said "hi"', amount: 7.25, category: 'Transport', date: '2026-06-04' });

    const res = await request(app)
      .get('/api/reports/monthly?month=6&year=2026&format=csv')
      .set(bearer(user.accessToken));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="expenses-2026-06.csv"');
    const body = res.text;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('Date,Title,Category,Amount,Description');
    expect(body).toContain('"Coffee, bagel"');
    expect(body).toContain('"He said ""hi"""');
    expect(body).toContain('Category,Spent,Budget,Remaining');
    expect(body).toContain('Food,5,,');
    expect(body).toContain('Total,12.25,,');
  });

  it('prefixes string cells with a quote for CSV injection vectors', retryOnSharedDbRace, async () => {
    const user = await registerUser(app);
    await seedExpense(user.userId, { title: '=SUM(A1:A9)', amount: 10, category: 'Other', date: '2026-06-01' });
    await seedExpense(user.userId, { title: '+danger', amount: 11, category: 'Other', date: '2026-06-02' });
    await seedExpense(user.userId, { title: '-danger', amount: 12, category: 'Other', date: '2026-06-03' });
    await seedExpense(user.userId, { title: '@danger', amount: 13, category: 'Other', date: '2026-06-04' });

    const res = await request(app)
      .get('/api/reports/monthly?month=6&year=2026&format=csv')
      .set(bearer(user.accessToken));

    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).toContain("'=SUM(A1:A9)");
    expect(body).toContain("'+danger");
    expect(body).toContain("'-danger");
    expect(body).toContain("'@danger");
    expect(body).toContain('Other,10,');
  });

  it('sends an XLSX workbook with styled sheets and injection-safe string cells', retryOnSharedDbRace, async () => {
    const user = await registerUser(app);
    await seedExpense(user.userId, { title: '=SUM(A1:A9)', amount: 10, category: 'Food', date: '2026-06-01' });
    await seedExpense(user.userId, { title: 'Coffee', amount: 5.5, category: 'Transport', date: '2026-06-02' });
    await seedBudget(user.userId, { category: 'Food', limit: 50, month: 6, year: 2026 });

    const res = await request(app)
      .get('/api/reports/monthly?month=6&year=2026&format=xlsx')
      .set(bearer(user.accessToken))
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe('attachment; filename="expenses-2026-06.xlsx"');

    const buffer = res.body as Buffer;
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['Expenses', 'Summary']);

    const expenses = sheet(workbook, 'Expenses');
    expect(expenses.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(expenses.views[0].state).toBe('frozen');
    const titleValue = expenses.getRow(2).getCell(2).value;
    expect(typeof titleValue).toBe('string');
    expect(String(titleValue).startsWith("'")).toBe(true);
    expect(expenses.getRow(2).getCell(4).numFmt).toBe('#,##0.00');
    expect(expenses.getRow(2).getCell(1).value).toBe('2026-06-01');

    const summary = sheet(workbook, 'Summary');
    expect(summary.getRow(1).getCell(2).font?.bold).toBe(true);
    expect(summary.views[0].state).toBe('frozen');
    expect(summary.getRow(2).getCell(2).numFmt).toBe('#,##0.00');
    expect(summary.getRow(4).getCell(1).value).toBe('Total');
    expect(summary.getRow(4).getCell(2).value).toBe(15.5);
  });
});

describe('GET /api/reports/yearly', () => {
  async function seedYear(): Promise<{ userId: string; accessToken: string }> {
    const user = await registerUser(app);
    const other = await registerUser(app);
    await seedExpense(user.userId, { title: 'March groceries', amount: 200, category: 'Food', date: '2026-03-15' });
    await seedExpense(user.userId, { title: 'June train', amount: 300, category: 'Transport', date: '2026-06-10' });
    await seedExpense(other.userId, { title: 'Other June spend', amount: 999, category: 'Food', date: '2026-06-01' });
    await seedBudget(user.userId, { category: 'Transport', limit: 500, month: 6, year: 2026 });
    return { userId: user.userId, accessToken: user.accessToken };
  }

  it('returns 12 monthly totals, category totals, and grand total (user-scoped)', retryOnSharedDbRace, async () => {
    const fixture = await seedYear();

    const res = await request(app)
      .get('/api/reports/yearly?year=2026')
      .set(bearer(fixture.accessToken));

    expect(res.status).toBe(200);
    const body = res.body as YearlyJson;
    expect(body.period).toEqual({ year: 2026 });
    expect(body.monthlyTotals).toHaveLength(12);
    expect(body.monthlyTotals[2]).toEqual({ month: 3, total: 200, budget: 0 });
    expect(body.monthlyTotals[5]).toEqual({ month: 6, total: 300, budget: 500 });
    expect(body.monthlyTotals.filter((row) => row.total !== 0)).toHaveLength(2);
    expect(body.categoryTotals).toEqual([
      { category: 'Food', total: 200 },
      { category: 'Transport', total: 300 },
    ]);
    expect(body.grandTotal).toBe(500);
  });

  it('sends yearly CSV with month and category sections', retryOnSharedDbRace, async () => {
    const fixture = await seedYear();

    const res = await request(app)
      .get('/api/reports/yearly?year=2026&format=csv')
      .set(bearer(fixture.accessToken));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="expenses-2026.csv"');
    const body = res.text;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('Month,Total spent,Total budget');
    expect(body).toContain('March,200,0');
    expect(body).toContain('June,300,500');
    expect(body).toContain('Total,500,500');
    expect(body).toContain('Category,Total spent');
    expect(body).toContain('Food,200');
    expect(body).toContain('Transport,300');
  });

  it('sends yearly XLSX with By Month and By Category sheets', retryOnSharedDbRace, async () => {
    const fixture = await seedYear();

    const res = await request(app)
      .get('/api/reports/yearly?year=2026&format=xlsx')
      .set(bearer(fixture.accessToken))
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe('attachment; filename="expenses-2026.xlsx"');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['By Month', 'By Category']);

    const byMonth = sheet(workbook, 'By Month');
    expect(byMonth.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(byMonth.views[0].state).toBe('frozen');
    expect(byMonth.getRow(7).getCell(1).value).toBe('June');
    expect(byMonth.getRow(7).getCell(2).numFmt).toBe('#,##0.00');
    expect(byMonth.getRow(7).getCell(3).numFmt).toBe('#,##0.00');
    expect(byMonth.getRow(14).getCell(1).value).toBe('Total');

    const byCategory = sheet(workbook, 'By Category');
    expect(byCategory.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(byCategory.getRow(1).getCell(2).font?.bold).toBe(true);
    expect(byCategory.getRow(2).getCell(1).value).toBe('Food');
  });
});

describe('report validation', () => {
  it('rejects bad month, bad format, unknown query keys, and missing tokens', retryOnSharedDbRace, async () => {
    const user = await registerUser(app);
    const token = bearer(user.accessToken);

    const badMonth = await request(app).get('/api/reports/monthly?month=13&year=2026').set(token);
    expect(badMonth.status).toBe(400);
    expect((badMonth.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const badFormat = await request(app).get('/api/reports/monthly?month=10&format=pdf').set(token);
    expect(badFormat.status).toBe(400);
    expect((badFormat.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const unknownKey = await request(app).get('/api/reports/monthly?month=10&foo=1').set(token);
    expect(unknownKey.status).toBe(400);
    expect((unknownKey.body as ErrorEnvelope).error.details ?? []).toContainEqual({
      field: '',
      message: 'Unrecognized key: "foo"',
    });

    const badYear = await request(app).get('/api/reports/yearly?year=1999').set(token);
    expect(badYear.status).toBe(400);
    expect((badYear.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const noToken = await request(app).get('/api/reports/monthly');
    expect(noToken.status).toBe(401);
    expect((noToken.body as ErrorEnvelope).error.code).toBe('UNAUTHORIZED');
  });
});

describe('row cap', () => {
  it('rejects a month above MAX_REPORT_ROWS with 400 VALIDATION_ERROR', retryOnSharedDbRace, async () => {
    const user = await registerUser(app);
    await prisma.$executeRaw`INSERT INTO "Expense" ("id","userId","title","amount","category","date","createdAt","updatedAt") SELECT gen_random_uuid()::text, ${user.userId}, 'Bulk', 1, 'Other', '2026-06-01'::date, now(), now() FROM generate_series(1, ${MAX_REPORT_ROWS + 1})`;

    const res = await request(app)
      .get('/api/reports/monthly?month=6&year=2026')
      .set(bearer(user.accessToken));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: `Report exceeds ${MAX_REPORT_ROWS} rows` },
    });
  });
});
