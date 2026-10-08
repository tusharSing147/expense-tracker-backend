import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface OpenApiBody {
  openapi: string;
  paths: Record<string, unknown>;
}

function errorBody(res: request.Response): ApiErrorBody {
  return res.body as ApiErrorBody;
}

describe('docs', () => {
  it('GET /api/docs redirects to the canonical trailing-slash URL', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(301);
    expect(res.headers['location']).toBe('/api/docs/');
  });

  it('GET /api/docs/ serves the swagger-ui page', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('swagger-ui');
  });

  it('GET /api/docs/openapi.json serves the spec document', async () => {
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    const body = res.body as OpenApiBody;
    expect(typeof body.openapi).toBe('string');
    expect(Object.keys(body.paths)).toContain('/api/auth/login');
    expect(Object.keys(body.paths)).toContain('/api/expenses');
    expect(Object.keys(body.paths)).toContain('/health');
  });

  it('GET unknown /api route still returns NOT_FOUND envelope', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(errorBody(res).error.code).toBe('NOT_FOUND');
    expect(typeof errorBody(res).error.message).toBe('string');
    expect(Object.keys(res.body)).toEqual(['error']);
  });
});
