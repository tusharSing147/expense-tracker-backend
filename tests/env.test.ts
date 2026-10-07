import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env';

function validRaw(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    PORT: '4000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/expense_tracker',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    JWT_ACCESS_EXPIRES: '15m',
    JWT_REFRESH_EXPIRES_DAYS: '7',
    CLIENT_URL: 'http://localhost:5173',
    COOKIE_SECURE: 'false',
    COOKIE_SAMESITE: 'lax',
    BCRYPT_COST: '12',
    LOG_LEVEL: 'info',
  };
}

function errorMessage(raw: Record<string, string | undefined>): string {
  try {
    parseEnv(raw);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('parseEnv did not throw');
}

function minimalRaw(): Record<string, string | undefined> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/expense_tracker',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    CLIENT_URL: 'http://localhost:5173',
  };
}

describe('parseEnv', () => {
  it('rejects a missing DATABASE_URL', () => {
    const raw = validRaw();
    delete raw.DATABASE_URL;
    expect(errorMessage(raw)).toContain('DATABASE_URL');
  });

  it('rejects an empty DATABASE_URL', () => {
    const raw = validRaw();
    raw.DATABASE_URL = '   ';
    expect(errorMessage(raw)).toContain('DATABASE_URL');
  });

  it('rejects a JWT_ACCESS_SECRET shorter than 32 characters', () => {
    const raw = validRaw();
    raw.JWT_ACCESS_SECRET = 'x'.repeat(31);
    expect(errorMessage(raw)).toContain('JWT_ACCESS_SECRET');
  });

  it('rejects identical access and refresh secrets', () => {
    const raw = validRaw();
    raw.JWT_REFRESH_SECRET = raw.JWT_ACCESS_SECRET;
    const message = errorMessage(raw);
    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).toContain('JWT_REFRESH_SECRET');
  });

  it("rejects COOKIE_SAMESITE='none' with COOKIE_SECURE=false", () => {
    const raw = validRaw();
    raw.COOKIE_SAMESITE = 'none';
    raw.COOKIE_SECURE = 'false';
    const message = errorMessage(raw);
    expect(message).toContain('COOKIE_SAMESITE');
    expect(message).toContain('COOKIE_SECURE');
  });

  it('rejects an invalid NODE_ENV', () => {
    const raw = validRaw();
    raw.NODE_ENV = 'staging';
    expect(errorMessage(raw)).toContain('NODE_ENV');
  });

  it("rejects PORT='abc'", () => {
    const raw = validRaw();
    raw.PORT = 'abc';
    expect(errorMessage(raw)).toContain('PORT');
  });

  it("rejects BCRYPT_COST='15'", () => {
    const raw = validRaw();
    raw.BCRYPT_COST = '15';
    expect(errorMessage(raw)).toContain('BCRYPT_COST');
  });

  it('rejects a missing CLIENT_URL', () => {
    const raw = validRaw();
    delete raw.CLIENT_URL;
    expect(errorMessage(raw)).toContain('CLIENT_URL');
  });

  it('rejects a CLIENT_URL that is not an absolute http(s) origin', () => {
    const raw = validRaw();
    raw.CLIENT_URL = 'ftp://example.com';
    expect(errorMessage(raw)).toContain('CLIENT_URL');
  });

  it("rejects a bad LOG_LEVEL", () => {
    const raw = validRaw();
    raw.LOG_LEVEL = 'verbose';
    expect(errorMessage(raw)).toContain('LOG_LEVEL');
  });

  it('collects every field problem into a single readable error', () => {
    const raw = validRaw();
    delete raw.DATABASE_URL;
    raw.PORT = 'abc';
    const message = errorMessage(raw);
    expect(message.startsWith('Invalid environment configuration:')).toBe(true);
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message.split('\n').length).toBeGreaterThan(2);
  });

  it('parses a valid configuration and applies defaults', () => {
    const parsed = parseEnv({
      ...minimalRaw(),
      CLIENT_URL: 'http://localhost:5173, https://app.example.com ,',
    });
    expect(parsed.PORT).toBe(5000);
    expect(parsed.BCRYPT_COST).toBe(12);
    expect(parsed.JWT_REFRESH_EXPIRES_DAYS).toBe(7);
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.JWT_ACCESS_EXPIRES).toBe('15m');
    expect(parsed.COOKIE_SECURE).toBe(false);
    expect(parsed.COOKIE_SAMESITE).toBe('lax');
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.CLIENT_URL).toEqual(['http://localhost:5173', 'https://app.example.com']);
    expect(parsed.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/expense_tracker');
  });

  it('parses a fully specified configuration', () => {
    const parsed = parseEnv(validRaw());
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(4000);
    expect(parsed.JWT_REFRESH_EXPIRES_DAYS).toBe(7);
    expect(parsed.COOKIE_SECURE).toBe(false);
    expect(parsed.CLIENT_URL).toEqual(['http://localhost:5173']);
  });

  it('coerces COOKIE_SECURE=true to a boolean', () => {
    const raw = validRaw();
    raw.COOKIE_SECURE = 'true';
    expect(parseEnv(raw).COOKIE_SECURE).toBe(true);
  });
});

