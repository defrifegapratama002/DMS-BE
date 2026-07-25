import { Router } from 'express';
import { getActivityLogs, exportActivityLogsCsv } from '../controllers/activityLogController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { validateQuery } from '../middlewares/validate.js';
import { activityLogQuerySchema } from '../schemas/activityLogSchemas.js';

const router = Router();

router.use(verifyToken);

router.get('/', validateQuery(activityLogQuerySchema), getActivityLogs);
router.get('/export', exportActivityLogsCsv);

export default router;