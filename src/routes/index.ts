import { Router } from 'express';
import authRoutes from './auth.routes';
import metaRoutes from './meta.routes';
import expenseRoutes from './expense.routes';
import budgetRoutes from './budget.routes';
import dashboardRoutes from './dashboard.routes';
import reportRoutes from './report.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/meta', metaRoutes);
router.use('/expenses', expenseRoutes);
router.use('/budgets', budgetRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);

export default router;
