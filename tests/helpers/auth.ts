import { randomUUID } from 'node:crypto';
import type { Application } from 'express';
import request from 'supertest';

export interface AuthFixture {
  userId: string;
  name: string;
  email: string;
  accessToken: string;
  refreshTokenCookie: string;
}

interface AuthResponseBody {
  user: { id: string; name?: string; email?: string };
  accessToken: string;
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export const csrfHeaders: { 'X-Requested-With': 'XMLHttpRequest' } = {
  'X-Requested-With': 'XMLHttpRequest',
};

export function extractRefreshCookie(res: request.Response): string {
  const raw: unknown = res.headers['set-cookie'];
  const cookies: string[] =
    typeof raw === 'string'
      ? [raw]
      : Array.isArray(raw)
        ? raw.filter((c): c is string => typeof c === 'string')
        : [];
  const cookie = cookies.find((c) => c.startsWith('refreshToken='));
  if (!cookie) {
    throw new Error(`refreshToken cookie missing from set-cookie: ${JSON.stringify(raw)}`);
  }
  return cookie.split(';')[0];
}

async function postAuth(
  app: Application,
  path: string,
  payload: Record<string, string>,
  expectedStatus: number,
  fallback: { name: string; email: string },
): Promise<AuthFixture> {
  const res = await request(app).post(path).set(csrfHeaders).send(payload);
  if (res.status !== expectedStatus) {
    throw new Error(
      `POST ${path} expected status ${expectedStatus}, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as AuthResponseBody;
  if (!body?.user?.id || typeof body.accessToken !== 'string') {
    throw new Error(`POST ${path} returned unexpected body: ${JSON.stringify(res.body)}`);
  }
  return {
    userId: body.user.id,
    name: body.user.name ?? fallback.name,
    email: body.user.email ?? fallback.email,
    accessToken: body.accessToken,
    refreshTokenCookie: extractRefreshCookie(res),
  };
}

export async function registerUser(
  app: Application,
  overrides?: { name?: string; email?: string; password?: string },
): Promise<AuthFixture> {
  const name = overrides?.name ?? 'Test User';
  const email = overrides?.email ?? `user-${randomUUID()}@example.com`;
  const password = overrides?.password ?? 'Password123';
  return postAuth(app, '/api/auth/register', { name, email, password }, 201, { name, email });
}

export async function loginUser(
  app: Application,
  creds: { email: string; password: string },
): Promise<AuthFixture> {
  const fallback = { name: 'Test User', email: creds.email };
  return postAuth(app, '/api/auth/login', { email: creds.email, password: creds.password }, 200, fallback);
}
