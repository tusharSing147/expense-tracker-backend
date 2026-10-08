import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { currentYearMonth } from '../src/utils/dates';
import { bearer, registerUser, type AuthFixture } from './helpers/auth';
import { resetDb } from './helpers/db';
import { budgetFixture } from './helpers/factory';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

interface BudgetResponse {
  id: string;
  category: string;
  limit: number;
  month: number;
  year: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: 'ok' | 'warning' | 'exceeded';
}

interface BudgetSeed {
  category: string;
  limit: number;
  month: number;
  year: number;
}

async function seedExpense(
  userId: string,
  o: { amount: number; category: string; date: string },
): Promise<void> {
  await prisma.expense.create({
    data: {
      userId,
      title: 'Seed',
      amount: o.amount,
      category: o.category,
      date: new Date(o.date + 'T00:00:00.000Z'),
      description: null,
    },
  });
}

async function createBudget(user: AuthFixture, seed: BudgetSeed): Promise<request.Response> {
  return request(app).post('/api/budgets').set(bearer(user.accessToken)).send(seed);
}

async function listBudgets(user: AuthFixture, query = ''): Promise<BudgetResponse[]> {
  const res = await request(app).get(`/api/budgets${query}`).set(bearer(user.accessToken));
  expect(res.status).toBe(200);
  return res.body as BudgetResponse[];
}

beforeEach(resetDb);

describe('POST /api/budgets', () => {
  it('creates a budget with spent 0, remaining = limit, percentUsed 0 and status ok', async () => {
    const user = await registerUser(app);
    const res = await createBudget(
      user,
      budgetFixture({ category: 'Food', limit: 1000, month: 10, year: 2026 }),
    );

    expect(res.status).toBe(201);
    const body = res.body as BudgetResponse;
    expect(Object.keys(body).sort()).toEqual([
      'category',
      'id',
      'limit',
      'month',
      'percentUsed',
      'remaining',
      'spent',
      'status',
      'year',
    ]);
    expect(body).toMatchObject({
      category: 'Food',
      limit: 1000,
      month: 10,
      year: 2026,
      spent: 0,
      remaining: 1000,
      percentUsed: 0,
      status: 'ok',
    });
    expect(typeof body.id).toBe('string');
  });

  it('rejects a duplicate category/month/year with 409 BUDGET_EXISTS but allows another month', async () => {
    const user = await registerUser(app);
    const first = await createBudget(user, budgetFixture({ category: 'Food', month: 10, year: 2026 }));
    expect(first.status).toBe(201);

    const dup = await createBudget(user, budgetFixture({ category: 'Food', month: 10, year: 2026 }));
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({
      error: {
        code: 'BUDGET_EXISTS',
        message: 'Budget already exists for this category and month',
      },
    });

    const otherMonth = await createBudget(
      user,
      budgetFixture({ category: 'Food', month: 11, year: 2026 }),
    );
    expect(otherMonth.status).toBe(201);
  });

  it('rejects invalid payloads with 400 VALIDATION_ERROR', async () => {
    const user = await registerUser(app);
    const base = budgetFixture({ limit: 500, month: 10, year: 2026 });
    const invalidPayloads: Record<string, unknown>[] = [
      { ...base, limit: 0 },
      { ...base, limit: -1 },
      { ...base, limit: 10.555 },
      { ...base, month: 13 },
      { ...base, month: 0 },
      { ...base, year: 2101 },
      { ...base, year: 1999 },
      { ...base, unknownKey: 'nope' },
      { limit: 500, month: 10, year: 2026 },
      { ...base, category: 'Vacation' },
    ];

    for (const payload of invalidPayloads) {
      const res = await request(app)
        .post('/api/budgets')
        .set(bearer(user.accessToken))
        .send(payload);
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects requests without an access token with 401', async () => {
    const noAuthPost = await request(app).post('/api/budgets').send(budgetFixture());
    expect(noAuthPost.status).toBe(401);
    expect(noAuthPost.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });

    const noAuthGet = await request(app).get('/api/budgets');
    expect(noAuthGet.status).toBe(401);
    expect(noAuthGet.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});

describe('PATCH /api/budgets/:id', () => {
  it('changes only the limit and recomputes spent, remaining and percentUsed', async () => {
    const user = await registerUser(app);
    const created = await createBudget(user, budgetFixture({ limit: 1000, month: 10, year: 2026 }));
    const id = (created.body as BudgetResponse).id;
    await seedExpense(user.userId, { amount: 100, category: 'Food', date: '2026-10-05' });
    await seedExpense(user.userId, { amount: 50, category: 'Food', date: '2026-10-20' });

    const res = await request(app)
      .patch(`/api/budgets/${id}`)
      .set(bearer(user.accessToken))
      .send({ limit: 500 });

    expect(res.status).toBe(200);
    expect(res.body as BudgetResponse).toMatchObject({
      id,
      category: 'Food',
      limit: 500,
      month: 10,
      year: 2026,
      spent: 150,
      remaining: 350,
      percentUsed: 30,
      status: 'ok',
    });
  });

  it('rejects a body containing category (immutable key) with 400', async () => {
    const user = await registerUser(app);
    const created = await createBudget(user, budgetFixture());
    const id = (created.body as BudgetResponse).id;

    const res = await request(app)
      .patch(`/api/budgets/${id}`)
      .set(bearer(user.accessToken))
      .send({ limit: 500, category: 'Transport' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a budget owned by another user', async () => {
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const foreign = await createBudget(userB, budgetFixture());

    const res = await request(app)
      .patch(`/api/budgets/${(foreign.body as BudgetResponse).id}`)
      .set(bearer(userA.accessToken))
      .send({ limit: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Budget not found' } });
  });

  it('returns 400 for a non-uuid id', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .patch('/api/budgets/not-a-uuid')
      .set(bearer(user.accessToken))
      .send({ limit: 100 });

    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/budgets/:id', () => {
  it('deletes with 204 and the budget no longer appears in the list', async () => {
    const user = await registerUser(app);
    const created = await createBudget(user, budgetFixture({ month: 10, year: 2026 }));
    const id = (created.body as BudgetResponse).id;

    const del = await request(app)
      .delete(`/api/budgets/${id}`)
      .set(bearer(user.accessToken));
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const rows = await listBudgets(user, '?month=10&year=2026');
    expect(rows).toEqual([]);
  });

  it('returns 404 when deleting a foreign budget', async () => {
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const foreign = await createBudget(userB, budgetFixture());

    const res = await request(app)
      .delete(`/api/budgets/${(foreign.body as BudgetResponse).id}`)
      .set(bearer(userA.accessToken));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Budget not found' } });

    const stillThere = await listBudgets(userB, '?month=10&year=2026');
    expect(stillThere).toHaveLength(1);
  });
});

describe('GET /api/budgets', () => {
  it('returns only the requested month when month and year are given', async () => {
    const user = await registerUser(app);
    await createBudget(user, budgetFixture({ category: 'Food', month: 10, year: 2026 }));
    await createBudget(user, budgetFixture({ category: 'Rent', month: 11, year: 2026 }));

    const october = await listBudgets(user, '?month=10&year=2026');
    expect(october).toHaveLength(1);
    expect(october[0]).toMatchObject({ category: 'Food', month: 10, year: 2026 });

    const november = await listBudgets(user, '?month=11&year=2026');
    expect(november).toHaveLength(1);
    expect(november[0]).toMatchObject({ category: 'Rent', month: 11, year: 2026 });
  });

  it('defaults to the current month when the query is omitted', async () => {
    const user = await registerUser(app);
    const current = currentYearMonth();
    const previous =
      current.month === 1
        ? { month: 12, year: current.year - 1 }
        : { month: current.month - 1, year: current.year };
    await createBudget(
      user,
      budgetFixture({ category: 'Food', month: current.month, year: current.year }),
    );
    await createBudget(user, budgetFixture({ category: 'Rent', month: previous.month, year: previous.year }));

    const rows = await listBudgets(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: 'Food',
      month: current.month,
      year: current.year,
    });
  });

  it("never includes another user's budgets", async () => {
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    await createBudget(userA, budgetFixture({ category: 'Food', month: 10, year: 2026 }));
    await prisma.budget.create({
      data: { userId: userB.userId, category: 'Rent', limit: 700, month: 10, year: 2026 },
    });

    const rows = await listBudgets(userA, '?month=10&year=2026');
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('Food');
    expect(JSON.stringify(rows)).not.toContain(userB.userId);
  });
});

describe('GET /api/budgets spent and status calculations', () => {
  it('counts only in-month expenses for the category and ignores unbudgeted categories', async () => {
    const user = await registerUser(app);
    await createBudget(user, budgetFixture({ category: 'Food', limit: 1000, month: 10, year: 2026 }));
    await seedExpense(user.userId, { amount: 100, category: 'Food', date: '2026-10-05' });
    await seedExpense(user.userId, { amount: 50, category: 'Food', date: '2026-10-20' });
    await seedExpense(user.userId, { amount: 999, category: 'Food', date: '2026-09-30' });
    await seedExpense(user.userId, { amount: 500, category: 'Food', date: '2026-11-01' });
    await seedExpense(user.userId, { amount: 700, category: 'Transport', date: '2026-10-10' });

    const rows = await listBudgets(user, '?month=10&year=2026');
    expect(rows).toHaveLength(1);
    expect(rows.find((r) => r.category === 'Transport')).toBeUndefined();
    expect(rows[0]).toMatchObject({
      category: 'Food',
      limit: 1000,
      spent: 150,
      remaining: 850,
      percentUsed: 15,
      status: 'ok',
    });
  });

  it('reports warning at 85% used', async () => {
    const user = await registerUser(app);
    await createBudget(user, budgetFixture({ category: 'Food', limit: 1000, month: 10, year: 2026 }));
    await seedExpense(user.userId, { amount: 850, category: 'Food', date: '2026-10-15' });

    const rows = await listBudgets(user, '?month=10&year=2026');
    expect(rows[0]).toMatchObject({
      spent: 850,
      remaining: 150,
      percentUsed: 85,
      status: 'warning',
    });
  });

  it('reports exceeded above 100% with a negative remaining', async () => {
    const user = await registerUser(app);
    await createBudget(user, budgetFixture({ category: 'Food', limit: 1000, month: 10, year: 2026 }));
    await seedExpense(user.userId, { amount: 700, category: 'Food', date: '2026-10-04' });
    await seedExpense(user.userId, { amount: 350, category: 'Food', date: '2026-10-25' });

    const rows = await listBudgets(user, '?month=10&year=2026');
    expect(rows[0]).toMatchObject({
      spent: 1050,
      remaining: -50,
      percentUsed: 105,
      status: 'exceeded',
    });
  });

  it('keeps exactly 80% and 100% at warning', async () => {
    const user = await registerUser(app);
    await createBudget(user, budgetFixture({ category: 'Food', limit: 1000, month: 3, year: 2026 }));
    await createBudget(user, budgetFixture({ category: 'Food', limit: 1000, month: 4, year: 2026 }));
    await seedExpense(user.userId, { amount: 800, category: 'Food', date: '2026-03-10' });
    await seedExpense(user.userId, { amount: 1000, category: 'Food', date: '2026-04-10' });

    const march = await listBudgets(user, '?month=3&year=2026');
    expect(march[0]).toMatchObject({ percentUsed: 80, status: 'warning', remaining: 200 });

    const april = await listBudgets(user, '?month=4&year=2026');
    expect(april[0]).toMatchObject({ percentUsed: 100, status: 'warning', remaining: 0 });
  });

  it('evaluates status on the raw percent while percentUsed is rounded', async () => {
    const user = await registerUser(app);
    await createBudget(user, budgetFixture({ category: 'Food', limit: 1000, month: 5, year: 2026 }));
    await seedExpense(user.userId, { amount: 1000.01, category: 'Food', date: '2026-05-10' });

    const rows = await listBudgets(user, '?month=5&year=2026');
    expect(rows[0].percentUsed).toBe(100);
    expect(rows[0].status).toBe('exceeded');
    expect(rows[0].remaining).toBeCloseTo(-0.01, 5);
  });
});

describe('POST /api/budgets/copy', () => {
  it('copies every source budget into the target month', async () => {
    const user = await registerUser(app);
    const seeds: BudgetSeed[] = [
      { category: 'Food', limit: 1000, month: 5, year: 2026 },
      { category: 'Transport', limit: 400, month: 5, year: 2026 },
      { category: 'Entertainment', limit: 250, month: 5, year: 2026 },
    ];
    for (const seed of seeds) {
      await prisma.budget.create({ data: { userId: user.userId, ...seed } });
    }

    const res = await request(app)
      .post('/api/budgets/copy')
      .set(bearer(user.accessToken))
      .send({ fromMonth: 5, fromYear: 2026, toMonth: 6, toYear: 2026 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ copied: 3, skipped: 0 });

    const june = await listBudgets(user, '?month=6&year=2026');
    expect(june).toHaveLength(3);
    expect(june.map((b) => b.category).sort()).toEqual(['Entertainment', 'Food', 'Transport']);
    expect(june.map((b) => b.limit).sort((a, b2) => a - b2)).toEqual([250, 400, 1000]);
  });

  it('skips categories that already exist in the target month', async () => {
    const user = await registerUser(app);
    const seeds: BudgetSeed[] = [
      { category: 'Food', limit: 1000, month: 5, year: 2026 },
      { category: 'Transport', limit: 400, month: 5, year: 2026 },
      { category: 'Entertainment', limit: 250, month: 5, year: 2026 },
    ];
    for (const seed of seeds) {
      await prisma.budget.create({ data: { userId: user.userId, ...seed } });
    }
    await prisma.budget.create({
      data: { userId: user.userId, category: 'Food', limit: 999, month: 6, year: 2026 },
    });

    const res = await request(app)
      .post('/api/budgets/copy')
      .set(bearer(user.accessToken))
      .send({ fromMonth: 5, fromYear: 2026, toMonth: 6, toYear: 2026 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ copied: 2, skipped: 1 });

    const june = await listBudgets(user, '?month=6&year=2026');
    expect(june).toHaveLength(3);
    expect(june.find((b) => b.category === 'Food')?.limit).toBe(999);
  });

  it('rejects an invalid copy payload with 400 and requires a token with 401', async () => {
    const user = await registerUser(app);

    const invalid = await request(app)
      .post('/api/budgets/copy')
      .set(bearer(user.accessToken))
      .send({ fromMonth: 13, fromYear: 2026, toMonth: 6, toYear: 2026 });
    expect(invalid.status).toBe(400);
    expect((invalid.body as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const noAuth = await request(app)
      .post('/api/budgets/copy')
      .send({ fromMonth: 5, fromYear: 2026, toMonth: 6, toYear: 2026 });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});
