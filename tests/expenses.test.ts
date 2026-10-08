import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { bearer, registerUser } from './helpers/auth';
import type { AuthFixture } from './helpers/auth';
import { resetDb } from './helpers/db';
import { expenseFixture } from './helpers/factory';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

interface ExpenseBody {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListBody {
  data: ExpenseBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  totals: { sumAmount: number };
}

interface SeedRow {
  title: string;
  amount: number;
  category: string;
  date: string;
  description?: string;
  createdAt?: string;
}

const BASE = '/api/expenses';

let alice: AuthFixture;
let bob: AuthFixture;

beforeEach(async () => {
  await resetDb();
  alice = await registerUser(app, { name: 'Alice' });
  bob = await registerUser(app, { name: 'Bob' });
});

async function createExpense(
  token: string,
  payload: Record<string, unknown>,
): Promise<ExpenseBody> {
  const res = await request(app).post(BASE).set(bearer(token)).send(payload);
  if (res.status !== 201) {
    throw new Error(`create expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body as ExpenseBody;
}

async function seedExpenses(userId: string, rows: SeedRow[]): Promise<string[]> {
  const created = await prisma.$transaction(
    rows.map((row) =>
      prisma.expense.create({
        data: {
          userId,
          title: row.title,
          amount: row.amount,
          category: row.category,
          date: new Date(`${row.date}T00:00:00.000Z`),
          description: row.description ?? null,
          createdAt: row.createdAt !== undefined ? new Date(row.createdAt) : undefined,
        },
      }),
    ),
  );
  return created.map((row) => row.id);
}

async function getList(token: string, query = ''): Promise<ListBody> {
  const res = await request(app).get(`${BASE}${query}`).set(bearer(token));
  expect(res.status).toBe(200);
  return res.body as ListBody;
}

async function expectValidationFailure(res: request.Response): Promise<void> {
  expect(res.status).toBe(400);
  const body = res.body as ErrorEnvelope;
  expect(body.error.code).toBe('VALIDATION_ERROR');
}

async function expectCreateRejected(payload: Record<string, unknown>): Promise<void> {
  const res = await request(app).post(BASE).set(bearer(alice.accessToken)).send(payload);
  await expectValidationFailure(res);
}

const filterRows: SeedRow[] = [
  { title: 'Grocery store', amount: 10, category: 'Food', date: '2026-09-01' },
  { title: 'Bus pass', amount: 20, category: 'Transport', date: '2026-09-15' },
  { title: 'Dinner out', amount: 30, category: 'Food', date: '2026-09-30' },
  { title: 'Cinema night', amount: 40, category: 'Entertainment', date: '2026-10-01' },
];

describe('POST /api/expenses', () => {
  it('creates an expense and returns 201 with the exact response shape', async () => {
    const res = await request(app)
      .post(BASE)
      .set(bearer(alice.accessToken))
      .send(expenseFixture());

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'amount',
      'category',
      'createdAt',
      'date',
      'description',
      'id',
      'title',
      'updatedAt',
    ]);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toBe('Grocery run');
    expect(typeof res.body.amount).toBe('number');
    expect(res.body.amount).toBe(42.5);
    expect(res.body.category).toBe('Food');
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.date).toBe('2026-10-01');
    expect(res.body.description).toBeNull();
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(res.body.updatedAt))).toBe(false);
  });

  it('round-trips a provided description and trims the title', async () => {
    const withDescription = await createExpense(
      alice.accessToken,
      expenseFixture({ description: 'Weekly groceries', date: '2020-05-05' }),
    );
    expect(withDescription.description).toBe('Weekly groceries');
    expect(withDescription.date).toBe('2020-05-05');

    const padded = await createExpense(
      alice.accessToken,
      expenseFixture({ title: '  Padded title  ' }),
    );
    expect(padded.title).toBe('Padded title');
  });

  it('rejects requests without an access token', async () => {
    const res = await request(app).post(BASE).send(expenseFixture());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});

describe('GET /api/expenses/:id', () => {
  it('returns the expense with 200', async () => {
    const created = await createExpense(alice.accessToken, expenseFixture());

    const res = await request(app)
      .get(`${BASE}/${created.id}`)
      .set(bearer(alice.accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(created);
  });

  it('returns 404 NOT_FOUND for a missing expense', async () => {
    const res = await request(app)
      .get(`${BASE}/11111111-1111-4111-8111-111111111111`)
      .set(bearer(alice.accessToken));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Expense not found' },
    });
  });
});

describe('PATCH /api/expenses/:id', () => {
  it('updates only the provided fields with 200', async () => {
    const created = await createExpense(
      alice.accessToken,
      expenseFixture({ description: 'Original note' }),
    );

    const res = await request(app)
      .patch(`${BASE}/${created.id}`)
      .set(bearer(alice.accessToken))
      .send({ title: 'Renamed expense' });

    expect(res.status).toBe(200);
    const body = res.body as ExpenseBody;
    expect(body.id).toBe(created.id);
    expect(body.title).toBe('Renamed expense');
    expect(body.amount).toBe(created.amount);
    expect(body.category).toBe(created.category);
    expect(body.date).toBe(created.date);
    expect(body.description).toBe('Original note');
  });

  it('clears the description when null is provided', async () => {
    const created = await createExpense(
      alice.accessToken,
      expenseFixture({ description: 'Original note' }),
    );

    const res = await request(app)
      .patch(`${BASE}/${created.id}`)
      .set(bearer(alice.accessToken))
      .send({ description: null });

    expect(res.status).toBe(200);
    expect((res.body as ExpenseBody).description).toBeNull();
  });
});

describe('DELETE /api/expenses/:id', () => {
  it('deletes with 204 and a subsequent GET returns 404', async () => {
    const created = await createExpense(alice.accessToken, expenseFixture());

    const del = await request(app)
      .delete(`${BASE}/${created.id}`)
      .set(bearer(alice.accessToken));
    expect(del.status).toBe(204);

    const after = await request(app)
      .get(`${BASE}/${created.id}`)
      .set(bearer(alice.accessToken));
    expect(after.status).toBe(404);
    expect((after.body as ErrorEnvelope).error.code).toBe('NOT_FOUND');
  });
});

describe('ownership isolation', () => {
  it('returns 404 (never 403) when another user reads, updates, or deletes a foreign expense', async () => {
    const aliceExpense = await createExpense(alice.accessToken, expenseFixture());

    const read = await request(app)
      .get(`${BASE}/${aliceExpense.id}`)
      .set(bearer(bob.accessToken));
    expect(read.status).toBe(404);
    expect((read.body as ErrorEnvelope).error.code).toBe('NOT_FOUND');

    const patch = await request(app)
      .patch(`${BASE}/${aliceExpense.id}`)
      .set(bearer(bob.accessToken))
      .send({ title: 'Hijacked' });
    expect(patch.status).toBe(404);
    expect((patch.body as ErrorEnvelope).error.code).toBe('NOT_FOUND');

    const del = await request(app)
      .delete(`${BASE}/${aliceExpense.id}`)
      .set(bearer(bob.accessToken));
    expect(del.status).toBe(404);
    expect((del.body as ErrorEnvelope).error.code).toBe('NOT_FOUND');

    const untouched = await request(app)
      .get(`${BASE}/${aliceExpense.id}`)
      .set(bearer(alice.accessToken));
    expect(untouched.status).toBe(200);
    expect((untouched.body as ExpenseBody).title).toBe('Grocery run');
  });

  it('never leaks foreign rows through the list endpoint', async () => {
    await createExpense(alice.accessToken, expenseFixture({ title: 'Alice only' }));
    const [bobId] = await seedExpenses(bob.userId, [
      { title: 'Bob secret', amount: 99, category: 'Other', date: '2026-09-10' },
    ]);

    const aliceList = await getList(alice.accessToken);
    expect(aliceList.meta.total).toBe(1);
    expect(aliceList.data.map((row) => row.title)).toEqual(['Alice only']);

    const readForeign = await request(app)
      .get(`${BASE}/${bobId}`)
      .set(bearer(alice.accessToken));
    expect(readForeign.status).toBe(404);

    const bobList = await getList(bob.accessToken);
    expect(bobList.meta.total).toBe(1);
    expect(bobList.data.map((row) => row.title)).toEqual(['Bob secret']);
  });
});

describe('GET /api/expenses filters', () => {
  beforeEach(async () => {
    await seedExpenses(alice.userId, filterRows);
  });

  it('filters by startDate and endDate inclusively on both boundaries', async () => {
    const body = await getList(alice.accessToken, '?startDate=2026-09-01&endDate=2026-09-15');
    expect(body.meta.total).toBe(2);
    expect(body.data.map((row) => row.title).sort()).toEqual(['Bus pass', 'Grocery store']);
    expect(body.totals.sumAmount).toBe(30);
  });

  it('filters by a single category', async () => {
    const body = await getList(alice.accessToken, '?category=Food');
    expect(body.meta.total).toBe(2);
    expect(body.data.map((row) => row.title).sort()).toEqual(['Dinner out', 'Grocery store']);
  });

  it('filters by comma-separated and repeated category values', async () => {
    const comma = await getList(alice.accessToken, '?category=Food,Transport');
    expect(comma.meta.total).toBe(3);
    expect(comma.data.map((row) => row.title).sort()).toEqual([
      'Bus pass',
      'Dinner out',
      'Grocery store',
    ]);

    const repeated = await getList(alice.accessToken, '?category=Food&category=Transport');
    expect(repeated.meta.total).toBe(3);
  });

  it('filters by inclusive minAmount and maxAmount bounds', async () => {
    const body = await getList(alice.accessToken, '?minAmount=20&maxAmount=30');
    expect(body.meta.total).toBe(2);
    expect(body.data.map((row) => row.amount).sort((a, b) => a - b)).toEqual([20, 30]);
    expect(body.totals.sumAmount).toBe(50);

    const single = await getList(alice.accessToken, '?minAmount=20&maxAmount=20');
    expect(single.meta.total).toBe(1);
    expect(single.data[0].title).toBe('Bus pass');
  });

  it('searches the title case-insensitively', async () => {
    const body = await getList(alice.accessToken, '?search=GROCERY');
    expect(body.meta.total).toBe(1);
    expect(body.data[0].title).toBe('Grocery store');

    const none = await getList(alice.accessToken, '?search=not-present');
    expect(none.meta.total).toBe(0);
    expect(none.data).toEqual([]);
    expect(none.totals.sumAmount).toBe(0);
  });

  it('applies combined filters together', async () => {
    const body = await getList(
      alice.accessToken,
      '?startDate=2026-09-01&endDate=2026-09-30&category=Food,Transport&minAmount=15&maxAmount=35',
    );
    expect(body.meta.total).toBe(2);
    expect(body.data.map((row) => row.title).sort()).toEqual(['Bus pass', 'Dinner out']);
    expect(body.totals.sumAmount).toBe(50);
    expect(body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });
});

describe('GET /api/expenses pagination and sorting', () => {
  it('paginates with correct meta and totals covering all filtered rows', async () => {
    const rows: SeedRow[] = Array.from({ length: 25 }, (_, index) => ({
      title: `Expense ${index + 1}`,
      amount: index + 1,
      category: 'Food',
      date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    }));
    await seedExpenses(alice.userId, rows);

    const body = await getList(alice.accessToken, '?page=2&limit=10');
    expect(body.data.length).toBe(10);
    expect(body.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(body.totals.sumAmount).toBe(325);

    const lastPage = await getList(alice.accessToken, '?page=3&limit=10');
    expect(lastPage.data.length).toBe(5);
    expect(lastPage.totals.sumAmount).toBe(325);
  });

  it('sorts by amount ascending and descending', async () => {
    await seedExpenses(alice.userId, [
      { title: 'Mid amount', amount: 10, category: 'Food', date: '2026-09-02' },
      { title: 'Low amount', amount: 5, category: 'Food', date: '2026-09-01' },
      { title: 'High amount', amount: 20, category: 'Food', date: '2026-09-03' },
    ]);

    const asc = await getList(alice.accessToken, '?sortBy=amount&order=asc');
    expect(asc.data.map((row) => row.amount)).toEqual([5, 10, 20]);
    expect(asc.data.map((row) => row.title)).toEqual(['Low amount', 'Mid amount', 'High amount']);

    const desc = await getList(alice.accessToken, '?sortBy=amount&order=desc');
    expect(desc.data.map((row) => row.amount)).toEqual([20, 10, 5]);
    expect(desc.data.map((row) => row.title)).toEqual([
      'High amount',
      'Mid amount',
      'Low amount',
    ]);
  });

  it('sorts by createdAt in both directions', async () => {
    await seedExpenses(alice.userId, [
      {
        title: 'Second created',
        amount: 10,
        category: 'Food',
        date: '2026-09-02',
        createdAt: '2026-09-02T10:00:00.000Z',
      },
      {
        title: 'Third created',
        amount: 5,
        category: 'Food',
        date: '2026-09-01',
        createdAt: '2026-09-03T10:00:00.000Z',
      },
      {
        title: 'First created',
        amount: 20,
        category: 'Food',
        date: '2026-09-03',
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ]);

    const asc = await getList(alice.accessToken, '?sortBy=createdAt&order=asc');
    expect(asc.data.map((row) => row.title)).toEqual([
      'First created',
      'Second created',
      'Third created',
    ]);

    const desc = await getList(alice.accessToken, '?sortBy=createdAt&order=desc');
    expect(desc.data.map((row) => row.title)).toEqual([
      'Third created',
      'Second created',
      'First created',
    ]);
  });
});

describe('validation failures', () => {
  const invalidCreates: { name: string; payload: Record<string, unknown> }[] = [
    { name: 'a zero amount', payload: expenseFixture({ amount: 0 }) },
    { name: 'a negative amount', payload: expenseFixture({ amount: -5 }) },
    { name: 'an amount with 3 decimal places', payload: expenseFixture({ amount: 10.999 }) },
    { name: 'an unknown category', payload: expenseFixture({ category: 'Groceries' }) },
    { name: 'an impossible calendar date', payload: expenseFixture({ date: '2026-02-30' }) },
    { name: 'a non ISO date', payload: expenseFixture({ date: '10-01-2026' }) },
    { name: 'an empty title', payload: expenseFixture({ title: '' }) },
    { name: 'an unknown body key', payload: { ...expenseFixture(), userId: 'attacker' } },
    {
      name: 'a missing amount',
      payload: { title: 'No amount', category: 'Food', date: '2026-09-01' },
    },
  ];

  for (const { name, payload } of invalidCreates) {
    it(`rejects ${name} with 400 VALIDATION_ERROR`, async () => {
      await expectCreateRejected(payload);
    });
  }

  it('rejects a date more than 1 year in the future', async () => {
    const now = new Date();
    const tooFar = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate() + 1));
    const date = [
      String(tooFar.getUTCFullYear()).padStart(4, '0'),
      String(tooFar.getUTCMonth() + 1).padStart(2, '0'),
      String(tooFar.getUTCDate()).padStart(2, '0'),
    ].join('-');
    await expectCreateRejected(expenseFixture({ date }));
  });

  const invalidQueries: { name: string; query: string }[] = [
    { name: 'startDate after endDate', query: '?startDate=2026-09-30&endDate=2026-09-01' },
    { name: 'page=0', query: '?page=0' },
    { name: 'limit=101', query: '?limit=101' },
    { name: 'minAmount above maxAmount', query: '?minAmount=100&maxAmount=10' },
    { name: 'an unknown query key', query: '?bogus=1' },
    { name: 'an unknown category value', query: '?category=Bogus' },
    { name: 'a malformed startDate', query: '?startDate=2026-13-01' },
  ];

  for (const { name, query } of invalidQueries) {
    it(`rejects ${name} with 400 VALIDATION_ERROR`, async () => {
      const res = await request(app).get(`${BASE}${query}`).set(bearer(alice.accessToken));
      await expectValidationFailure(res);
    });
  }

  it('rejects an invalid uuid path parameter before touching the database', async () => {
    const get = await request(app).get(`${BASE}/not-a-uuid`).set(bearer(alice.accessToken));
    await expectValidationFailure(get);

    const patch = await request(app)
      .patch(`${BASE}/not-a-uuid`)
      .set(bearer(alice.accessToken))
      .send({ title: 'Nope' });
    await expectValidationFailure(patch);

    const del = await request(app)
      .delete(`${BASE}/not-a-uuid`)
      .set(bearer(alice.accessToken));
    await expectValidationFailure(del);
  });

  it('rejects a patch body with no updatable fields', async () => {
    const created = await createExpense(alice.accessToken, expenseFixture());
    const res = await request(app)
      .patch(`${BASE}/${created.id}`)
      .set(bearer(alice.accessToken))
      .send({});
    await expectValidationFailure(res);
  });

  it('rejects list requests without an access token', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });
});
