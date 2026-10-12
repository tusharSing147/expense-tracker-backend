import type { Prisma } from '@prisma/client';

export function toNumber(value: Prisma.Decimal | number | string): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeBudgetStatus(percentUsedRaw: number): 'ok' | 'warning' | 'exceeded' {
  if (percentUsedRaw < 80) return 'ok';
  if (percentUsedRaw <= 100) return 'warning';
  return 'exceeded';
}
