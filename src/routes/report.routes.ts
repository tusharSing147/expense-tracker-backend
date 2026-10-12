import { Router } from 'express';
import { monthlyReport, yearlyReport } from '../controllers/report.controller';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { monthlyReportQuerySchema, yearlyReportQuerySchema } from '../validators/report.validator';

const router = Router();

router.get('/monthly', requireAuth, validate({ query: monthlyReportQuerySchema }), monthlyReport);
router.get('/yearly', requireAuth, validate({ query: yearlyReportQuerySchema }), yearlyReport);

export default router;
