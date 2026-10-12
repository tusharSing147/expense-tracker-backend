import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

interface ApiErrorBody {
  error: { code: string; message: string };
}

function errorBody(res: request.Response): ApiErrorBody {
  return res.body as ApiErrorBody;
}

describe('smoke', () => {
  it('GET /health returns ok with x-request-id', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    const requestId = res.headers['x-request-id'];
    expect(typeof requestId).toBe('string');
    expect((requestId as string).length).toBeGreaterThan(0);
  });

  it('GET /health/ready returns ok', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET unknown /api route returns NOT_FOUND envelope', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(errorBody(res).error.code).toBe('NOT_FOUND');
    expect(typeof errorBody(res).error.message).toBe('string');
    expect(Object.keys(res.body)).toEqual(['error']);
  });

  it('POST with unsupported content type returns VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/definitely-not-a-route')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(400);
    expect(errorBody(res).error.code).toBe('VALIDATION_ERROR');
    expect(errorBody(res).error.message.toLowerCase()).toContain('content');
  });

  it('POST with malformed JSON returns VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/definitely-not-a-route')
      .set('Content-Type', 'application/json')
      .send('{ invalid json');
    expect(res.status).toBe(400);
    expect(errorBody(res).error.code).toBe('VALIDATION_ERROR');
    expect(errorBody(res).error.message).toBe('Malformed JSON body');
  });
});
