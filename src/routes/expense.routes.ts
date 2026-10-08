import { Router } from 'express';
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  updateExpense,
} from '../controllers/expense.controller';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createExpenseSchema,
  idParamsSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from '../validators/expense.validator';

const router = Router();

router.get('/', requireAuth, validate({ query: listExpensesQuerySchema }), listExpenses);
router.post('/', requireAuth, validate({ body: createExpenseSchema }), createExpense);
router.get('/:id', requireAuth, validate({ params: idParamsSchema }), getExpense);
router.patch(
  '/:id',
  requireAuth,
  validate({ params: idParamsSchema, body: updateExpenseSchema }),
  updateExpense,
);
router.delete('/:id', requireAuth, validate({ params: idParamsSchema }), deleteExpense);

export default router;
