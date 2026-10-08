import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { MAX_REPORT_ROWS } from '../config/constants';
import { prisma } from '../config/prisma';
import { escapeTextCell, toCsv } from '../utils/csv';
import { MONTH_NAMES, formatDateOnly, monthStartEnd } from '../utils/dates';
import { toNumber } from '../utils/money';
import type { MonthlyReportQuery, YearlyReportQuery } from '../validators/report.validator';

type SheetRow = (string | number | null)[];

interface ExpenseRow {
  id: string;
  date: string;
  title: string;
  category: string;
  amount: number;
  description: string | null;
  createdAt: Date;
}

interface CategoryTotalRow {
  category: string;
  spent: number;
  budget: number | null;
  remaining: number | null;
}

interface YearCategoryRow {
  category: string;
  total: number;
}

interface MonthlyTotalRow {
  month: number;
  total: number;
  budget: number;
}

interface BudgetSummary {
  budgetSum: number;
  remainingTotal: number;
}

function mapExpense(expense: {
  id: string;
  date: Date;
  title: string;
  category: string;
  amount: Prisma.Decimal;
  description: string | null;
  createdAt: Date;
}): ExpenseRow {
  return {
    id: expense.id,
    date: formatDateOnly(expense.date),
    title: expense.title,
    category: expense.category,
    amount: toNumber(expense.amount),
    description: expense.description,
    createdAt: expense.createdAt,
  };
}

function buildCategoryTotals(
  groups: Array<{ category: string; _sum: { amount: Prisma.Decimal | null } }>,
  budgets: Array<{ category: string; limit: Prisma.Decimal }>,
): CategoryTotalRow[] {
  const spentByCategory = new Map<string, number>();
  for (const group of groups) {
    spentByCategory.set(group.category, toNumber(group._sum.amount ?? 0));
  }
  const budgetByCategory = new Map<string, number>();
  for (const budget of budgets) {
    budgetByCategory.set(budget.category, toNumber(budget.limit));
  }
  const categories = [...new Set([...spentByCategory.keys(), ...budgetByCategory.keys()])].sort();
  return categories.map((category) => {
    const spent = spentByCategory.get(category) ?? 0;
    const budget = budgetByCategory.get(category);
    return {
      category,
      spent,
      budget: budget ?? null,
      remaining: budget === undefined ? null : budget - spent,
    };
  });
}

function budgetSummary(rows: CategoryTotalRow[]): BudgetSummary | null {
  let budgetSum = 0;
  let spentBudgeted = 0;
  let found = false;
  for (const row of rows) {
    if (row.budget !== null) {
      found = true;
      budgetSum += row.budget;
      spentBudgeted += row.spent;
    }
  }
  return found ? { budgetSum, remainingTotal: budgetSum - spentBudgeted } : null;
}

function totalRow(total: number, summary: BudgetSummary | null): SheetRow {
  if (summary === null) {
    return ['Total', total, '', ''];
  }
  return ['Total', total, summary.budgetSum, summary.remainingTotal];
}

function sendCsv(res: Response, csv: string, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(buffer);
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: SheetRow[],
  numericColumns: number[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers.map(escapeTextCell));
  const headerRow = sheet.getRow(1);
  headers.forEach((_header, index) => {
    headerRow.getCell(index + 1).font = { bold: true };
  });
  for (const row of rows) {
    sheet.addRow(row.map((cell) => (typeof cell === 'string' ? escapeTextCell(cell) : cell)));
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  headers.forEach((_header, index) => {
    let width = headers[index].length;
    for (const row of rows) {
      const value = row[index];
      if (value !== null && value !== undefined) {
        width = Math.max(width, String(value).length);
      }
    }
    sheet.getColumn(index + 1).width = Math.min(60, Math.max(10, width + 2));
  });

  for (const columnIndex of numericColumns) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const cell = sheet.getRow(rowIndex + 2).getCell(columnIndex + 1);
      if (typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00';
      }
    }
  }
}

function monthlyCsv(
  expenses: ExpenseRow[],
  categoryTotals: CategoryTotalRow[],
  total: number,
): string {
  const summary = budgetSummary(categoryTotals);
  return toCsv(['Date', 'Title', 'Category', 'Amount', 'Description'], [
    ...expenses.map((expense) => [
      expense.date,
      expense.title,
      expense.category,
      expense.amount,
      expense.description,
    ]),
    [],
    ['Category', 'Spent', 'Budget', 'Remaining'],
    ...categoryTotals.map((row) => [row.category, row.spent, row.budget, row.remaining]),
    totalRow(total, summary),
  ]);
}

async function monthlyXlsx(
  expenses: ExpenseRow[],
  categoryTotals: CategoryTotalRow[],
  total: number,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  addSheet(
    workbook,
    'Expenses',
    ['Date', 'Title', 'Category', 'Amount', 'Description'],
    expenses.map((expense) => [
      expense.date,
      expense.title,
      expense.category,
      expense.amount,
      expense.description,
    ]),
    [3],
  );
  const summary = budgetSummary(categoryTotals);
  addSheet(
    workbook,
    'Summary',
    ['Category', 'Spent', 'Budget', 'Remaining'],
    [
      ...categoryTotals.map((row) => [row.category, row.spent, row.budget, row.remaining]),
      totalRow(total, summary),
    ],
    [1, 2, 3],
  );
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function buildMonthlyTotals(userId: string, year: number): Promise<MonthlyTotalRow[]> {
  return Promise.all(
    Array.from({ length: 12 }, (_value, index) => index + 1).map(async (month) => {
      const range = monthStartEnd(year, month);
      const [expenseTotals, budgetTotals] = await Promise.all([
        prisma.expense.aggregate({
          where: { userId, date: { gte: range.start, lt: range.end } },
          _sum: { amount: true },
        }),
        prisma.budget.aggregate({ where: { userId, month, year }, _sum: { limit: true } }),
      ]);
      return {
        month,
        total: toNumber(expenseTotals._sum.amount ?? 0),
        budget: toNumber(budgetTotals._sum.limit ?? 0),
      };
    }),
  );
}

function sumMonthlyBudgets(monthlyTotals: MonthlyTotalRow[]): number {
  return monthlyTotals.reduce((sum, row) => sum + row.budget, 0);
}

function yearlyCsv(
  monthlyTotals: MonthlyTotalRow[],
  categoryTotals: YearCategoryRow[],
  grandTotal: number,
): string {
  const budgetSum = sumMonthlyBudgets(monthlyTotals);
  return toCsv(['Month', 'Total spent', 'Total budget'], [
    ...monthlyTotals.map((row) => [MONTH_NAMES[row.month - 1], row.total, row.budget]),
    ['Total', grandTotal, budgetSum],
    [],
    ['Category', 'Total spent'],
    ...categoryTotals.map((row) => [row.category, row.total]),
  ]);
}

async function yearlyXlsx(
  monthlyTotals: MonthlyTotalRow[],
  categoryTotals: YearCategoryRow[],
  grandTotal: number,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const budgetSum = sumMonthlyBudgets(monthlyTotals);
  addSheet(
    workbook,
    'By Month',
    ['Month', 'Total spent', 'Total budget'],
    [
      ...monthlyTotals.map((row) => [MONTH_NAMES[row.month - 1], row.total, row.budget]),
      ['Total', grandTotal, budgetSum],
    ],
    [1, 2],
  );
  addSheet(
    workbook,
    'By Category',
    ['Category', 'Total spent'],
    categoryTotals.map((row) => [row.category, row.total]),
    [1],
  );
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function monthlyReport(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const { month, year, format } = req.query as unknown as MonthlyReportQuery;
  const range = monthStartEnd(year, month);
  const dateFilter = { gte: range.start, lt: range.end };

  const expenses = await prisma.expense.findMany({
    where: { userId, date: dateFilter },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  if (expenses.length > MAX_REPORT_ROWS) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `Report exceeds ${MAX_REPORT_ROWS} rows` },
    });
    return;
  }

  const [groups, budgets, totals] = await Promise.all([
    prisma.expense.groupBy({
      by: ['category'],
      where: { userId, date: dateFilter },
      _sum: { amount: true },
    }),
    prisma.budget.findMany({ where: { userId, month, year } }),
    prisma.expense.aggregate({ where: { userId, date: dateFilter }, _sum: { amount: true } }),
  ]);

  const categoryTotals = buildCategoryTotals(groups, budgets);
  const total = toNumber(totals._sum.amount ?? 0);
  const expenseRows = expenses.map(mapExpense);
  const filename = `expenses-${year}-${String(month).padStart(2, '0')}`;

  if (format === 'csv') {
    sendCsv(res, monthlyCsv(expenseRows, categoryTotals, total), `${filename}.csv`);
    return;
  }
  if (format === 'xlsx') {
    const buffer = await monthlyXlsx(expenseRows, categoryTotals, total);
    sendXlsx(res, buffer, `${filename}.xlsx`);
    return;
  }
  res.status(200).json({ period: { month, year }, expenses: expenseRows, categoryTotals, total });
}

export async function yearlyReport(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const { year, format } = req.query as unknown as YearlyReportQuery;
  const yearFilter = {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };

  const [monthlyTotals, groups, totals] = await Promise.all([
    buildMonthlyTotals(userId, year),
    prisma.expense.groupBy({
      by: ['category'],
      where: { userId, date: yearFilter },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({ where: { userId, date: yearFilter }, _sum: { amount: true } }),
  ]);

  const categoryTotals = groups
    .map((group) => ({ category: group.category, total: toNumber(group._sum.amount ?? 0) }))
    .sort((left, right) => left.category.localeCompare(right.category));
  const grandTotal = toNumber(totals._sum.amount ?? 0);

  if (format === 'csv') {
    sendCsv(res, yearlyCsv(monthlyTotals, categoryTotals, grandTotal), `expenses-${year}.csv`);
    return;
  }
  if (format === 'xlsx') {
    const buffer = await yearlyXlsx(monthlyTotals, categoryTotals, grandTotal);
    sendXlsx(res, buffer, `expenses-${year}.xlsx`);
    return;
  }
  res.status(200).json({ period: { year }, monthlyTotals, categoryTotals, grandTotal });
}
