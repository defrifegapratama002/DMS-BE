import { Router } from 'express';
import {
  getDocuments,
  uploadDocument,
  getDocumentDetail,
  updateDocument,
  uploadNewVersion,
  getDocumentVersions,
  deleteDocument,
} from '../controllers/documentController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';
import { upload } from '../middlewares/upload.js';

const router = Router();

router.use(verifyToken);

router.get('/', getDocuments);

router.post(
  '/',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  upload.single('file'),
  uploadDocument
);

router.get('/:id', getDocumentDetail);

router.patch(
  '/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  updateDocument
);

router.post(
  '/:id/versions',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  upload.single('file'),
  uploadNewVersion
);

router.get('/:id/versions', getDocumentVersions);

router.delete(
  '/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  deleteDocument
);

export default router;