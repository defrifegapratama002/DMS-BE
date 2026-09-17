import { Router } from 'express';
import { searchAll } from '../controllers/searchController.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = Router();
router.use(verifyToken);

router.get('/', searchAll);

export default router;