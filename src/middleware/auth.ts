import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../utils/tokens';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;
const CSRF_HEADER_VALUE = 'xmlhttprequest';

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? BEARER_PATTERN.exec(header) : null;
  if (!match) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return;
  }

  const result = verifyAccessToken(match[1]);
  if (!result.ok) {
    if (result.reason === 'expired') {
      res.status(401).json({
        error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' },
      });
      return;
    }
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid access token' },
    });
    return;
  }

  req.user = { id: result.claims.sub };
  next();
};

export const requireCsrfHeader: RequestHandler = (req, res, next) => {
  const raw = req.headers['x-requested-with'];
  const value = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  if (value !== CSRF_HEADER_VALUE) {
    res.status(403).json({
      error: { code: 'CSRF_REJECTED', message: 'Missing or invalid X-Requested-With header' },
    });
    return;
  }
  next();
};
