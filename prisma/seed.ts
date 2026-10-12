import bcrypt from 'bcryptjs';
import { type Category } from '../src/config/constants';
import { env } from '../src/config/env';
import { logger } from '../src/config/logger';
import { prisma } from '../src/config/prisma';

if (env.NODE_ENV === 'test') {
  throw new Error('Refusing to seed when NODE_ENV=test');
}

const DEMO_EMAIL = 'demo@expense.local';
const DEMO_NAME = 'Demo User';
const DEMO_PASSWORD = 'Demo1234';

const MONTHS_BACK = 6;
const INJECTION_TITLE = '=SUM(A1:A9)';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TemplateEntry {
  day: number;
  category: Category;
  title: string;
  description: string | null;
  minCents: number;
  maxCents: number;
  fixedCents?: number;
}

const TEMPLATE: TemplateEntry[] = [
  { day: 1, category: 'Rent', title: 'Apartment rent', description: 'Monthly rent transfer', minCents: 0, maxCents: 0, fixedCents: 120000 },
  { day: 3, category: 'Food', title: INJECTION_TITLE, description: 'CSV injection probe', minCents: 0, maxCents: 0, fixedCents: 1234 },
  { day: 4, category: 'Food', title: 'Weekly groceries', description: null, minCents: 450, maxCents: 8500 },
  { day: 6, category: 'Transport', title: 'Metro card top-up', description: null, minCents: 300, maxCents: 6000 },
  { day: 8, category: 'Utilities', title: 'Electricity bill', description: 'Monthly kWh usage', minCents: 3000, maxCents: 14000 },
  { day: 10, category: 'Food', title: 'Dinner with friends', description: null, minCents: 1200, maxCents: 7500 },
  { day: 12, category: 'Entertainment', title: 'Cinema tickets', description: null, minCents: 800, maxCents: 4500 },
  { day: 14, category: 'Health', title: 'Pharmacy', description: null, minCents: 1500, maxCents: 12000 },
  { day: 16, category: 'Shopping', title: 'New sneakers', description: null, minCents: 1500, maxCents: 30000 },
  { day: 18, category: 'Transport', title: 'Taxi home', description: null, minCents: 500, maxCents: 4000 },
  { day: 20, category: 'Entertainment', title: 'Streaming services', description: 'Monthly subscriptions', minCents: 900, maxCents: 3500 },
  { day: 22, category: 'Food', title: 'Coffee + snacks', description: null, minCents: 300, maxCents: 2500 },
  { day: 24, category: 'Other', title: 'Gift for mom', description: null, minCents: 500, maxCents: 5000 },
  { day: 26, category: 'Education', title: 'Online course', description: null, minCents: 2000, maxCents: 15000 },
  { day: 28, category: 'Travel', title: 'Weekend trip train', description: null, minCents: 5000, maxCents: 45000 },
];

const BUDGETED_CATEGORIES: Category[] = [
  'Food',
  'Transport',
  'Entertainment',
  'Rent',
  'Utilities',
  'Shopping',
];

interface SeedExpense {
  userId: string;
  title: string;
  amountCents: number;
  category: Category;
  date: Date;
  description: string | null;
}

function buildMonths(now: Date): { year: number; month: number; isCurrent: boolean }[] {
  const months: { year: number; month: number; isCurrent: boolean }[] = [];
  for (let offset = MONTHS_BACK - 1; offset >= 0; offset -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      isCurrent: offset === 0,
    });
  }
  return months;
}

function amountCents(entry: TemplateEntry, rand: () => number): number {
  if (entry.fixedCents !== undefined) return entry.fixedCents;
  return entry.minCents + Math.floor(rand() * (entry.maxCents - entry.minCents + 1));
}

function dayOfMonth(entryDay: number, todayDay: number, isCurrent: boolean): number {
  if (!isCurrent) return entryDay;
  return Math.max(1, Math.round((entryDay * todayDay) / 28));
}

function main(): void {
  const now = new Date();
  const todayDay = now.getUTCDate();
  const rand = mulberry32(0xc0ffee);
  const months = buildMonths(now);
  const current = months[months.length - 1];

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, env.BCRYPT_COST);

  prisma
    .$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { email: DEMO_EMAIL } });
      const user = await tx.user.create({
        data: { name: DEMO_NAME, email: DEMO_EMAIL, passwordHash },
        select: { id: true },
      });

      const expenses: SeedExpense[] = [];
      for (const m of months) {
        for (const entry of TEMPLATE) {
          expenses.push({
            userId: user.id,
            title: entry.title,
            amountCents: amountCents(entry, rand),
            category: entry.category,
            date: new Date(Date.UTC(m.year, m.month - 1, dayOfMonth(entry.day, todayDay, m.isCurrent))),
            description: entry.description,
          });
        }
      }

      await tx.expense.createMany({
        data: expenses.map((e) => ({
          userId: e.userId,
          title: e.title,
          amount: (e.amountCents / 100).toFixed(2),
          category: e.category,
          date: e.date,
          description: e.description,
        })),
      });

      const currentSpend = new Map<Category, number>();
      for (const e of expenses) {
        if (e.date.getUTCFullYear() === current.year && e.date.getUTCMonth() + 1 === current.month) {
          currentSpend.set(e.category, (currentSpend.get(e.category) ?? 0) + e.amountCents);
        }
      }

      const targetRatio: Partial<Record<Category, number>> = {
        Food: 0.77,
        Transport: 0.85,
        Entertainment: 1.15,
      };
      const fixedLimitCents: Partial<Record<Category, number>> = {
        Rent: 120000,
        Utilities: 20000,
        Shopping: 40000,
      };

      const limitCents = new Map<Category, number>();
      for (const category of BUDGETED_CATEGORIES) {
        const spend = currentSpend.get(category) ?? 0;
        const ratio = targetRatio[category];
        if (ratio !== undefined) {
          limitCents.set(category, spend > 0 ? Math.max(1, Math.round(spend / ratio)) : 10000);
        } else {
          limitCents.set(category, fixedLimitCents[category] ?? 10000);
        }
      }

      const budgetRows: { userId: string; category: Category; limit: string; month: number; year: number }[] = [];
      for (const m of months) {
        for (const category of BUDGETED_CATEGORIES) {
          budgetRows.push({
            userId: user.id,
            category,
            limit: ((limitCents.get(category) ?? 10000) / 100).toFixed(2),
            month: m.month,
            year: m.year,
          });
        }
      }
      await tx.budget.createMany({ data: budgetRows });

      const statuses: Record<string, string> = {};
      for (const category of BUDGETED_CATEGORIES) {
        const spend = currentSpend.get(category) ?? 0;
        const limit = limitCents.get(category) ?? 10000;
        const percent = limit > 0 ? Math.round((spend / limit) * 1000) / 10 : 0;
        const status = percent < 80 ? 'ok' : percent <= 100 ? 'warning' : 'exceeded';
        statuses[category] = `${percent}% (${status})`;
      }

      const totalSpentCents = [...currentSpend.values()].reduce((sum, v) => sum + v, 0);
      const totalBudgetCents = [...limitCents.values()].reduce((sum, v) => sum + v, 0);

      logger.info(
        {
          user: DEMO_EMAIL,
          months: months.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`),
          expenses: expenses.length,
          budgets: budgetRows.length,
          currentMonth: {
            totalSpent: totalSpentCents / 100,
            totalBudget: totalBudgetCents / 100,
            statuses,
          },
        },
        'seed complete',
      );
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'seed failed');
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

main();
