import 'dotenv/config';
import { z } from 'zod';

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES: string;
  JWT_REFRESH_EXPIRES_DAYS: number;
  CLIENT_URL: string[];
  COOKIE_SECURE: boolean;
  COOKIE_SAMESITE: 'lax' | 'strict' | 'none';
  DOCS_ENABLED: boolean;
  BCRYPT_COST: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

const NODE_ENVS = ['development', 'test', 'production'] as const;
const SAME_SITE = ['lax', 'strict', 'none'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const DURATION = /^\d+[smhd]$/;

const clientUrls = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine((entries) => entries.length >= 1, {
    message: 'must contain at least one origin',
  })
  .refine(
    (entries) =>
      entries.every((entry) => {
        try {
          const url = new URL(entry);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      }),
    { message: 'must be a comma-separated list of absolute http(s) origins' },
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    DATABASE_URL: z.string().trim().min(1, 'must be a non-empty connection string'),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_EXPIRES: z.string().regex(DURATION, "must look like '15m' (e.g. 15m, 12h, 7d)").default('15m'),
    JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    CLIENT_URL: clientUrls,
    COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    COOKIE_SAMESITE: z.enum(SAME_SITE).default('lax'),
    DOCS_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
    BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
      });
    }
    if (value.COOKIE_SAMESITE === 'none' && value.COOKIE_SECURE === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: "COOKIE_SAMESITE 'none' requires COOKIE_SECURE=true",
      });
    }
  });

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const field = issue.path.length > 0 ? String(issue.path[0]) : 'environment';
    return ` - ${field}: ${issue.message}`;
  });
  return `Invalid environment configuration:\n${lines.join('\n')}`;
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatIssues(result.error));
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
