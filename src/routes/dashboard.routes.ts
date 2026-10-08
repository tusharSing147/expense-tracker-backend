import { Router } from 'express';
import { getSummary } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { summaryQuerySchema } from '../validators/dashboard.validator';

const router = Router();

router.get('/summary', requireAuth, validate({ query: summaryQuerySchema }), getSummary);

export default router;
