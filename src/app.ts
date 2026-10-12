import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { globalLimiter } from './middleware/rateLimit';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import apiRouter from './routes/index';
import docsRouter from './docs';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
  })
);

app.use(helmet());
app.use(compression());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(globalLimiter);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const contentType = req.headers['content-type'];
    if (contentType !== undefined && !contentType.toLowerCase().startsWith('application/json')) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Unsupported content type; expected application/json',
        },
      });
      return;
    }
  }
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok' });
  } catch {
    res.status(503).json({
      error: { code: 'NOT_READY', message: 'Database unavailable' },
    });
  }
});

app.use('/api', apiRouter);

if (env.DOCS_ENABLED) {
  app.use('/api/docs', docsRouter);
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
