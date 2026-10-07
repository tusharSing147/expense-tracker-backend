import { Router, type RequestHandler } from 'express';
import { CATEGORIES } from '../config/constants';
import { requireAuth } from '../middleware/auth';

const sendCategories: RequestHandler = (_req, res) => {
  res.status(200).json(CATEGORIES);
};

const router = Router();

router.get('/categories', requireAuth, sendCategories);

export default router;
