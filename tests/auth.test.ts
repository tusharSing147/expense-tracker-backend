import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { CATEGORIES, JWT_AUDIENCE, JWT_ISSUER } from '../src/config/constants';
import { env } from '../src/config/env';
import { bearer, csrfHeaders, extractRefreshCookie, loginUser, registerUser } from './helpers/auth';
import { resetDb } from './helpers/db';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface AuthBody {
  user: PublicUser;
  accessToken: string;
}

function errorBody(res: request.Response): ErrorEnvelope {
  return res.body as ErrorEnvelope;
}

function authBody(res: request.Response): AuthBody {
  return res.body as AuthBody;
}

function setCookieLines(res: request.Response): string[] {
  const raw: unknown = res.headers['set-cookie'];
  if (typeof raw === 'string') {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw.filter((line): line is string => typeof line === 'string');
  }
  return [];
}

function refreshCookieLine(res: request.Response): string {
  const line = setCookieLines(res).find((candidate) => candidate.startsWith('refreshToken='));
  if (line === undefined) {
    throw new Error(`refreshToken cookie missing from set-cookie: ${JSON.stringify(res.headers['set-cookie'])}`);
  }
  return line;
}

function refreshCookieCleared(res: request.Response): boolean {
  const line = setCookieLines(res).find((candidate) => candidate.startsWith('refreshToken='));
  if (line === undefined) {
    return false;
  }
  if (/max-age=0(?:;|$)/i.test(line)) {
    return true;
  }
  const match = /expires=([^;]+)/i.exec(line);
  if (match !== null) {
    const expires = Date.parse(match[1]);
    return !Number.isNaN(expires) && expires <= Date.now();
  }
  return false;
}

function postRefresh(cookie?: string): request.Test {
  const req = request(app).post('/api/auth/refresh').set(csrfHeaders);
  if (cookie !== undefined) {
    req.set('Cookie', cookie);
  }
  return req;
}

async function expectRegisterValidationError(
  input: Record<string, unknown>,
  expectedDetail: { field: string; message: string },
): Promise<void> {
  const res = await request(app).post('/api/auth/register').set(csrfHeaders).send(input);
  expect(res.status).toBe(400);
  const body = errorBody(res);
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.message).toBe('Validation failed');
  expect(body.error.details).toBeDefined();
  expect(body.error.details ?? []).toContainEqual(expectedDetail);
}

beforeEach(resetDb);

describe('POST /api/auth/register', () => {
  it('returns 201 with public user, access token, and an HttpOnly refresh cookie', async () => {
    const name = 'Regina Example';
    const email = `reg-ok-${randomUUID()}@example.com`;
    const password = 'Str0ngPass1';
    const res = await request(app)
      .post('/api/auth/register')
      .set(csrfHeaders)
      .send({ name, email, password });

    expect(res.status).toBe(201);
    const body = authBody(res);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
    expect(Object.keys(body.user).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    expect(body.user.email).toBe(email);
    expect(body.user.name).toBe(name);
    expect(typeof body.user.id).toBe('string');
    expect(Number.isNaN(Date.parse(body.user.createdAt))).toBe(false);
    expect(typeof body.accessToken).toBe('string');

    const serialized = JSON.stringify(res.body).toLowerCase();
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain(password.toLowerCase());

    const cookie = refreshCookieLine(res);
    expect(cookie.startsWith('refreshToken=')).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=');
    expect(cookie.toLowerCase()).not.toContain('secure');
  });

  it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
    const payload = { name: 'Dup User', email: `dup-${randomUUID()}@example.com`, password: 'Str0ngPass1' };
    const first = await request(app).post('/api/auth/register').set(csrfHeaders).send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/auth/register').set(csrfHeaders).send(payload);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({
      error: { code: 'EMAIL_TAKEN', message: 'Email already registered' },
    });
  });

  it('rejects a password shorter than 8 characters', async () => {
    await expectRegisterValidationError(
      { name: 'Weak Password', email: `weak-${randomUUID()}@example.com`, password: 'Ab1' },
      { field: 'password', message: 'Too small: expected string to have >=8 characters' },
    );
  });

  it('rejects an 8+ character password with no digit', async () => {
    await expectRegisterValidationError(
      { name: 'Weak Password', email: `nodigit-${randomUUID()}@example.com`, password: 'abcdefgh' },
      { field: 'password', message: 'Must contain at least one digit' },
    );
  });

  it('rejects a password with no letter', async () => {
    await expectRegisterValidationError(
      { name: 'Weak Password', email: `noleTter-${randomUUID()}@example.com`, password: '12345678' },
      { field: 'password', message: 'Must contain at least one letter' },
    );
  });

  it('rejects a password that equals the name', async () => {
    await expectRegisterValidationError(
      { name: 'User12345', email: `eqname-${randomUUID()}@example.com`, password: 'User12345' },
      { field: 'password', message: 'Password must not equal the name' },
    );
  });

  it('rejects a password that equals the lowercased email', async () => {
    await expectRegisterValidationError(
      { name: 'Equal Email', email: 'Sam@X.com', password: 'sam@x.com' },
      { field: 'password', message: 'Password must not equal the email' },
    );
  });

  it('rejects unknown extra body keys', async () => {
    await expectRegisterValidationError(
      {
        name: 'Extra Key',
        email: `extra-${randomUUID()}@example.com`,
        password: 'Str0ngPass1',
        role: 'admin',
      },
      { field: '', message: 'Unrecognized key: "role"' },
    );
  });

  it('rejects an invalid email', async () => {
    await expectRegisterValidationError(
      { name: 'Bad Email', email: 'not-an-email', password: 'Str0ngPass1' },
      { field: 'email', message: 'Invalid email address' },
    );
  });

  it('rejects a missing name', async () => {
    await expectRegisterValidationError(
      { email: `noname-${randomUUID()}@example.com`, password: 'Str0ngPass1' },
      { field: 'name', message: 'Invalid input: expected string, received undefined' },
    );
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 with user, access token, and a refresh cookie', async () => {
    const email = `login-ok-${randomUUID()}@example.com`;
    const password = 'Password123';
    await registerUser(app, { name: 'Login User', email, password });

    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
    const body = authBody(res);
    expect(Object.keys(body.user).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    expect(body.user.email).toBe(email);
    expect(typeof body.accessToken).toBe('string');
    const cookie = refreshCookieLine(res);
    expect(cookie.startsWith('refreshToken=')).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const email = `wrongpw-${randomUUID()}@example.com`;
    await registerUser(app, { email, password: 'Password123' });

    const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass99' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
  });

  it('returns a body identical to the wrong-password response for an unknown email', async () => {
    const email = `known-${randomUUID()}@example.com`;
    await registerUser(app, { email, password: 'Password123' });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'WrongPass99' });
    expect(wrongPassword.status).toBe(401);
    expect(errorBody(wrongPassword).error.code).toBe('INVALID_CREDENTIALS');

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: `ghost-${randomUUID()}@example.com`, password: 'WrongPass99' });
    expect(unknownEmail.status).toBe(401);
    expect(errorBody(unknownEmail).error.code).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(unknownEmail.body)).toBe(JSON.stringify(wrongPassword.body));
  });

  it('locks the account after 5 failed attempts and rejects the correct password with 423', async () => {
    const email = `lockout-${randomUUID()}@example.com`;
    const password = 'Password123';
    await registerUser(app, { name: 'Locked User', email, password });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request(app)
        .post('/api/auth/login')
        .send({ email, password: `WrongPass${attempt}` });
      expect(failed.status).toBe(401);
      expect(errorBody(failed).error.code).toBe('INVALID_CREDENTIALS');
    }

    const locked = await request(app).post('/api/auth/login').send({ email, password });
    expect(locked.status).toBe(423);
    const body = errorBody(locked);
    expect(body.error.code).toBe('ACCOUNT_LOCKED');
    expect(body.error.message).toMatch(/\d+ minute/);
  });

  it('rejects missing and empty login fields with 400', async () => {
    const missing = await request(app).post('/api/auth/login').send({});
    expect(missing.status).toBe(400);
    expect(errorBody(missing).error.code).toBe('VALIDATION_ERROR');
    expect(errorBody(missing).error.details ?? []).toContainEqual({
      field: 'email',
      message: 'Invalid input: expected string, received undefined',
    });

    const empty = await request(app).post('/api/auth/login').send({ email: '', password: '' });
    expect(empty.status).toBe(400);
    expect(errorBody(empty).error.code).toBe('VALIDATION_ERROR');
    expect(errorBody(empty).error.details ?? []).toContainEqual({
      field: 'email',
      message: 'Invalid email address',
    });
    expect(errorBody(empty).error.details ?? []).toContainEqual({
      field: 'password',
      message: 'Too small: expected string to have >=1 characters',
    });
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the cookie and returns only an access token', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .set(csrfHeaders)
      .send({ name: 'Rotate User', email: `rotate-${randomUUID()}@example.com`, password: 'Password123' });
    expect(reg.status).toBe(201);
    expect('refreshToken' in (reg.body as Record<string, unknown>)).toBe(false);
    const cookie1 = extractRefreshCookie(reg);

    const res = await postRefresh(cookie1);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['accessToken']);
    expect('refreshToken' in (res.body as Record<string, unknown>)).toBe(false);
    expect(typeof (res.body as { accessToken?: unknown }).accessToken).toBe('string');
    const cookie2 = extractRefreshCookie(res);
    expect(cookie2).not.toBe(cookie1);
    expect(refreshCookieLine(res)).toContain('HttpOnly');
    expect(refreshCookieLine(res)).toContain('Path=/api/auth');
  });

  it('rejects reuse of the rotated-away cookie with 401 TOKEN_REUSED', async () => {
    const fixture = await registerUser(app);
    const rotated = await postRefresh(fixture.refreshTokenCookie);
    expect(rotated.status).toBe(200);

    const reused = await postRefresh(fixture.refreshTokenCookie);
    expect(reused.status).toBe(401);
    expect(reused.body).toEqual({
      error: { code: 'TOKEN_REUSED', message: 'Refresh token reuse detected' },
    });
  });

  it('revokes the whole token family when an old cookie is replayed', async () => {
    const fixture = await registerUser(app);
    const rotated = await postRefresh(fixture.refreshTokenCookie);
    expect(rotated.status).toBe(200);
    const cookie2 = extractRefreshCookie(rotated);

    const reusedOld = await postRefresh(fixture.refreshTokenCookie);
    expect(reusedOld.status).toBe(401);
    expect(errorBody(reusedOld).error.code).toBe('TOKEN_REUSED');

    const current = await postRefresh(cookie2);
    expect(current.status).toBe(401);
    expect(current.body).toEqual({
      error: { code: 'TOKEN_REUSED', message: 'Refresh token reuse detected' },
    });
  });

  it('rejects a valid cookie without X-Requested-With with 403 CSRF_REJECTED', async () => {
    const fixture = await registerUser(app);
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', fixture.refreshTokenCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: 'CSRF_REJECTED',
        message: 'Missing or invalid X-Requested-With header',
      },
    });
  });

  it('rejects a refresh with no cookie with 401 NO_REFRESH_TOKEN', async () => {
    const res = await postRefresh();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token provided' },
    });
  });

  it('rejects a garbage cookie with 401 and clears the cookie', async () => {
    const res = await postRefresh('refreshToken=not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' },
    });
    expect(refreshCookieCleared(res)).toBe(true);
  });
});

describe('POST /api/auth/logout and /api/auth/logout-all', () => {
  it('logs out with 204, clears the cookie, and the cookie can no longer refresh', async () => {
    const fixture = await registerUser(app);

    const res = await request(app)
      .post('/api/auth/logout')
      .set(csrfHeaders)
      .set('Cookie', fixture.refreshTokenCookie);
    expect(res.status).toBe(204);
    expect(refreshCookieCleared(res)).toBe(true);

    const after = await postRefresh(fixture.refreshTokenCookie);
    expect(after.status).toBe(401);
    expect(errorBody(after).error.code).toBe('TOKEN_REUSED');
  });

  it('always succeeds with 204 when the cookie is missing or invalid', async () => {
    const noCookie = await request(app).post('/api/auth/logout').set(csrfHeaders);
    expect(noCookie.status).toBe(204);

    const garbage = await request(app)
      .post('/api/auth/logout')
      .set(csrfHeaders)
      .set('Cookie', 'refreshToken=garbage-value');
    expect(garbage.status).toBe(204);
  });

  it('logout-all revokes every session and clears the cookie', async () => {
    const sessionA = await registerUser(app);
    const sessionB = await loginUser(app, { email: sessionA.email, password: 'Password123' });

    const res = await request(app)
      .post('/api/auth/logout-all')
      .set(bearer(sessionA.accessToken));
    expect(res.status).toBe(204);
    expect(refreshCookieCleared(res)).toBe(true);

    for (const cookie of [sessionA.refreshTokenCookie, sessionB.refreshTokenCookie]) {
      const after = await postRefresh(cookie);
      expect(after.status).toBe(401);
      expect(errorBody(after).error.code).toBe('TOKEN_REUSED');
    }
  });
});

describe('access token enforcement', () => {
  it('rejects a missing Authorization header with 401 UNAUTHORIZED', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  });

  it('rejects malformed Authorization headers with 401 UNAUTHORIZED', async () => {
    for (const header of ['Basic xyz', 'Bearer', 'Bearer ']) {
      const res = await request(app).get('/api/auth/me').set('Authorization', header);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }
  });

  it('rejects an expired access token with 401 TOKEN_EXPIRED', async () => {
    const fixture = await registerUser(app);
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = jwt.sign(
      { sub: fixture.userId, iat: nowSec - 3600, exp: nowSec - 60 },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );

    const res = await request(app).get('/api/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' },
    });
  });

  it('rejects a tampered access token with 401 UNAUTHORIZED', async () => {
    const fixture = await registerUser(app);
    const parts = fixture.accessToken.split('.');
    expect(parts.length).toBe(3);
    const payloadSegment = parts[1];
    const midpoint = Math.floor(payloadSegment.length / 2);
    const replacement = payloadSegment[midpoint] === 'A' ? 'B' : 'A';
    const tampered = [
      parts[0],
      `${payloadSegment.slice(0, midpoint)}${replacement}${payloadSegment.slice(midpoint + 1)}`,
      parts[2],
    ].join('.');
    expect(tampered).not.toBe(fixture.accessToken);

    const res = await request(app).get('/api/auth/me').set(bearer(tampered));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
    });
  });

  it('rejects a token signed with algorithm none (algorithm pinning)', async () => {
    const fixture = await registerUser(app);
    const nowSec = Math.floor(Date.now() / 1000);
    const unsigned = jwt.sign(
      { sub: fixture.userId, iat: nowSec - 60, exp: nowSec + 600 },
      null,
      { algorithm: 'none', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );

    const res = await request(app).get('/api/auth/me').set(bearer(unsigned));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
    });
  });
});

describe('GET /api/auth/me and /api/meta/categories', () => {
  it('returns the registered user for a valid token and 401 for a forged token', async () => {
    const fixture = await registerUser(app, { name: 'Me User' });

    const ok = await request(app).get('/api/auth/me').set(bearer(fixture.accessToken));
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body)).toEqual(['user']);
    const user = (ok.body as { user: PublicUser }).user;
    expect(user.id).toBe(fixture.userId);
    expect(user.email).toBe(fixture.email);
    expect(user.name).toBe('Me User');

    const nowSec = Math.floor(Date.now() / 1000);
    const forged = jwt.sign(
      { sub: fixture.userId, iat: nowSec - 60, exp: nowSec + 900 },
      env.JWT_REFRESH_SECRET,
      { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    );
    const bad = await request(app).get('/api/auth/me').set(bearer(forged));
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
    });
  });

  it('serves the category list with a token and 401 without one', async () => {
    const fixture = await registerUser(app);

    const ok = await request(app)
      .get('/api/meta/categories')
      .set(bearer(fixture.accessToken));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(Array.from(CATEGORIES));

    const noAuth = await request(app).get('/api/meta/categories');
    expect(noAuth.status).toBe(401);
    expect(errorBody(noAuth).error.code).toBe('UNAUTHORIZED');
  });
});
