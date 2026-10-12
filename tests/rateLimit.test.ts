import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../src/middleware/rateLimit';

describe('createRateLimiter', () => {
  it('responds 429 with the error envelope once the limit is exceeded', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2 }));
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });

    const first = await request(app).get('/ping');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });

    const second = await request(app).get('/ping');
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true });

    const third = await request(app).get('/ping');
    expect(third.status).toBe(429);
    expect(third.body).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });
    expect(Object.keys(third.body)).toEqual(['error']);
  });
});
