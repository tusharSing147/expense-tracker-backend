export interface ExpenseFixtureInput {
  title?: string;
  amount?: number;
  category?: string;
  date?: string;
  description?: string | null;
}

export function expenseFixture(overrides: ExpenseFixtureInput = {}): {
  title: string;
  amount: number;
  category: string;
  date: string;
  description?: string;
} {
  const { description, ...rest } = overrides;
  const fixture: { title: string; amount: number; category: string; date: string; description?: string } = {
    title: 'Grocery run',
    amount: 42.5,
    category: 'Food',
    date: '2026-10-01',
    ...rest,
  };
  if (description !== undefined) {
    // API accepts null to clear the description; fixture result type stays string per contract.
    fixture.description = description as string;
  }
  return fixture;
}

export interface BudgetFixtureInput {
  category?: string;
  limit?: number;
  month?: number;
  year?: number;
}

export function budgetFixture(overrides: BudgetFixtureInput = {}): {
  category: string;
  limit: number;
  month: number;
  year: number;
} {
  return {
    category: 'Food',
    limit: 500,
    month: 10,
    year: 2026,
    ...overrides,
  };
}
