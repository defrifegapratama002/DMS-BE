import { Router } from 'express';
import { getDashboardStats } from '../controllers/statsController.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();
router.use(verifyToken);

router.get('/dashboard', getDashboardStats);

export default router;