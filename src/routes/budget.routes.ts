import { Router } from 'express';
import {
  copyBudgets,
  createBudget,
  deleteBudget,
  listBudgets,
  updateBudget,
} from '../controllers/budget.controller';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  budgetIdParamsSchema,
  copyBudgetsSchema,
  createBudgetSchema,
  listBudgetsQuerySchema,
  updateBudgetSchema,
} from '../validators/budget.validator';

const router = Router();

router.get('/', requireAuth, validate({ query: listBudgetsQuerySchema }), listBudgets);
router.post('/', requireAuth, validate({ body: createBudgetSchema }), createBudget);
router.post('/copy', requireAuth, validate({ body: copyBudgetsSchema }), copyBudgets);
router.patch(
  '/:id',
  requireAuth,
  validate({ params: budgetIdParamsSchema, body: updateBudgetSchema }),
  updateBudget,
);
router.delete('/:id', requireAuth, validate({ params: budgetIdParamsSchema }), deleteBudget);

export default router;
