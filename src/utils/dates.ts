export const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthStartEnd(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const absolute = year * 12 + (month - 1) + delta;
  const normalizedYear = Math.floor(absolute / 12);
  return { year: normalizedYear, month: absolute - normalizedYear * 12 + 1 };
}

export function lastNMonths(n: number, refYear: number, refMonth: number): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  for (let offset = n - 1; offset >= 0; offset--) {
    months.push(addMonths(refYear, refMonth, -offset));
  }
  return months;
}

export function formatDateOnly(d: Date): string {
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
