import { Router } from 'express';
import {
  createDocument,
  getDocumentById,
  renameDocument,
  uploadNewVersion,
  getVersionHistory,
  deleteDocument,
} from '../controllers/documentController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';
import { validateBody } from '../middlewares/validate.js';
import { createDocumentSchema, renameDocumentSchema, uploadVersionSchema } from '../schemas/documentSchemas.js';

const router = Router();

router.use(verifyToken);

router.post('/', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(createDocumentSchema), createDocument);
router.get('/:id', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AUDITOR', 'EMPLOYEE'), getDocumentById);
router.patch('/:id/rename', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(renameDocumentSchema), renameDocument);
router.post('/:id/versions', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(uploadVersionSchema), uploadNewVersion);
router.get('/:id/versions', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AUDITOR', 'EMPLOYEE'), getVersionHistory);
router.delete('/:id', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'), deleteDocument);

export default router;