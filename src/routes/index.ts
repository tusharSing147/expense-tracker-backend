import { Router } from 'express';
import authRoutes from './auth.routes';
import metaRoutes from './meta.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/meta', metaRoutes);

export default router;
