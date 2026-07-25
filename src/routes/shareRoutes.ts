import { Router } from 'express';
import {
  shareDocument,
  getDocumentShares,
  getSharedWithMe,
  updateShareAccess,
  revokeShare,
} from '../controllers/shareController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';
import { validateBody } from '../middlewares/validate.js';
import { shareDocumentSchema, updateShareAccessSchema } from '../schemas/shareSchemas.js';

const router = Router();

router.use(verifyToken);

router.get('/shared-with-me', getSharedWithMe);
router.post('/documents/:id/share', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(shareDocumentSchema), shareDocument);
router.get('/documents/:id/share', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), getDocumentShares);
router.patch('/:shareId', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(updateShareAccessSchema), updateShareAccess);
router.delete('/:shareId', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), revokeShare);

export default router;