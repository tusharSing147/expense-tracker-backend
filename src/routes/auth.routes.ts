import { Router } from 'express';
import {
  login,
  logout,
  logoutAll,
  me,
  refresh,
  register,
} from '../controllers/auth.controller';
import { requireAuth, requireCsrfHeader } from '../middleware/auth';
import { authLimiter, refreshLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema } from '../validators/auth.validator';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), register);
router.post('/login', authLimiter, validate({ body: loginSchema }), login);
router.post('/refresh', refreshLimiter, requireCsrfHeader, refresh);
router.post('/logout', requireCsrfHeader, logout);
router.post('/logout-all', requireAuth, logoutAll);
router.get('/me', requireAuth, me);

export default router;
