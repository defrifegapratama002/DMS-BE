import { Router } from 'express';
import {
  shareDocument,
  getDocumentShares,
  getSharedWithMe,
  updateShareAccess,
  revokeShare,
} from '../controllers/shareController.js';
import { ShareLinkController } from '../controllers/shareLinkController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';
import { validateBody } from '../middlewares/validate.js';
import { shareDocumentSchema, updateShareAccessSchema } from '../schemas/shareSchemas.js';

const router = Router();

router.use(verifyToken);

router.get('/shared-with-me', getSharedWithMe);

// Tautan publik (ShareLink)
router.get('/documents/:id/links', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), ShareLinkController.list);
router.post('/documents/:id/links', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), ShareLinkController.create);
router.delete('/links/:linkId', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), ShareLinkController.revoke);
router.post('/documents/:id/share', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(shareDocumentSchema), shareDocument);
router.get('/documents/:id/share', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), getDocumentShares);
router.patch('/:shareId', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(updateShareAccessSchema), updateShareAccess);
router.delete('/:shareId', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), revokeShare);

export default router;