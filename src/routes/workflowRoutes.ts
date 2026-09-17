import { Router } from 'express';
import { WorkflowRuleController } from '../controllers/workflowRuleController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';

// Otomatisasi (workflow rules) — admin only.
const router = Router();
router.use(verifyToken);
router.use(checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'));

router.get('/', WorkflowRuleController.list);
router.post('/', WorkflowRuleController.create);
router.patch('/:id', WorkflowRuleController.update);
router.delete('/:id', WorkflowRuleController.remove);
router.post('/:id/move', WorkflowRuleController.move);

export default router;