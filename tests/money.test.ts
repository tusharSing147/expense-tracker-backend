import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { toNumber, round1, computeBudgetStatus } from '../src/utils/money';

describe('toNumber', () => {
  it('passes numbers through unchanged', () => {
    expect(toNumber(12.5)).toBe(12.5);
  });

  it('parses numeric strings', () => {
    expect(toNumber('12.50')).toBe(12.5);
  });

  it('converts Prisma Decimals', () => {
    expect(toNumber(new Prisma.Decimal('1.1'))).toBe(1.1);
    expect(toNumber(new Prisma.Decimal('1234.56'))).toBe(1234.56);
  });
});

describe('round1', () => {
  it('rounds down to one decimal place', () => {
    expect(round1(77.54)).toBe(77.5);
  });

  it('rounds up to one decimal place', () => {
    expect(round1(77.56)).toBe(77.6);
  });

  it('leaves already-rounded values untouched', () => {
    expect(round1(80)).toBe(80);
  });
});

describe('computeBudgetStatus', () => {
  it('is ok below 80 percent', () => {
    expect(computeBudgetStatus(79.9)).toBe('ok');
  });

  it('is warning at exactly 80 percent', () => {
    expect(computeBudgetStatus(80)).toBe('warning');
  });

  it('is warning at exactly 100 percent', () => {
    expect(computeBudgetStatus(100)).toBe('warning');
  });

  it('is exceeded above 100 percent', () => {
    expect(computeBudgetStatus(100.1)).toBe('exceeded');
  });
});
