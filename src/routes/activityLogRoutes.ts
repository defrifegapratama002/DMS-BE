import { Router } from 'express';
import { ActivityLogController } from '../controllers/activityLogController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';

const router = Router();

router.use(verifyToken);

router.get('/me', ActivityLogController.getMyActivity);
router.get('/stats', ActivityLogController.getStats);

router.get(
  '/export',
  checkRole('SUPER_ADMIN', 'AUDITOR'),
  ActivityLogController.exportCsv
);

router.get(
  '/',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AUDITOR'),
  ActivityLogController.getLogs
);

export default router;