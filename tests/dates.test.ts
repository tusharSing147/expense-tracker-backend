import { describe, it, expect } from 'vitest';
import {
  MONTH_NAMES,
  monthStartEnd,
  currentYearMonth,
  addMonths,
  lastNMonths,
  formatDateOnly,
} from '../src/utils/dates';

describe('monthStartEnd', () => {
  it('returns inclusive UTC start and exclusive UTC end for a month', () => {
    const { start, end } = monthStartEnd(2026, 10);
    expect(start.getTime()).toBe(Date.UTC(2026, 9, 1));
    expect(end.getTime()).toBe(Date.UTC(2026, 10, 1));
    expect(end.getTime() - start.getTime()).toBe(31 * 24 * 60 * 60 * 1000);
  });

  it('rolls a December end boundary into the next year', () => {
    const { start, end } = monthStartEnd(2026, 12);
    expect(start.getTime()).toBe(Date.UTC(2026, 11, 1));
    expect(end.getTime()).toBe(Date.UTC(2027, 0, 1));
  });
});

describe('currentYearMonth', () => {
  it('returns a UTC year and a month between 1 and 12', () => {
    const { year, month } = currentYearMonth();
    expect(Number.isInteger(year)).toBe(true);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(month).toBe(new Date().getUTCMonth() + 1);
  });
});

describe('addMonths', () => {
  it('rolls a year forward for December plus one', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('rolls a year backward for a negative delta', () => {
    expect(addMonths(2026, 1, -3)).toEqual({ year: 2025, month: 10 });
  });

  it('keeps months in range for a zero delta', () => {
    expect(addMonths(2026, 7, 0)).toEqual({ year: 2026, month: 7 });
  });
});

describe('lastNMonths', () => {
  it('includes the reference month and ascends oldest first', () => {
    expect(lastNMonths(3, 2026, 1)).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });

  it('spans a year boundary in ascending order', () => {
    expect(lastNMonths(6, 2026, 3)).toEqual([
      { year: 2025, month: 10 },
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ]);
  });

  it('returns a single month when n is 1', () => {
    expect(lastNMonths(1, 2026, 5)).toEqual([{ year: 2026, month: 5 }]);
  });
});

describe('formatDateOnly', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    expect(formatDateOnly(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });

  it('zero pads month and day', () => {
    expect(formatDateOnly(new Date(Date.UTC(2026, 10, 9)))).toBe('2026-11-09');
  });
});

describe('MONTH_NAMES', () => {
  it('holds the twelve full English month names in order', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe('January');
    expect(MONTH_NAMES[11]).toBe('December');
  });
});
