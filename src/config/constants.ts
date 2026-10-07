export const CATEGORIES = [
  'Food',
  'Transport',
  'Rent',
  'Utilities',
  'Health',
  'Entertainment',
  'Shopping',
  'Education',
  'Travel',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const JWT_ISSUER = 'expense-tracker';
export const JWT_AUDIENCE = 'expense-tracker-web';
export const REFRESH_COOKIE_NAME = 'refreshToken';
export const REFRESH_COOKIE_PATH = '/api/auth';
export const MAX_REPORT_ROWS = 50000;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
