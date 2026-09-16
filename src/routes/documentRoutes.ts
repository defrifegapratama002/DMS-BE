import { Router } from 'express';
import {
  getDocuments,
  uploadDocument,
  getDocumentDetail,
  updateDocument,
  uploadNewVersion,
  getDocumentVersions,
  deleteDocument,
  getTrash,
  restoreDocument,
  purgeDocument,
  emptyTrash,
} from '../controllers/documentController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';
import { upload } from '../middlewares/upload.js';

const router = Router();

router.use(verifyToken);

// ⚠️ Trash routes HARUS di atas /:id (Express match dari atas)
router.get('/trash', getTrash);
router.delete(
  '/trash',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  emptyTrash
);

// Documents
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

// Restore (sebelum delete /:id)
router.post('/:id/restore', restoreDocument);

// Purge permanent
router.delete(
  '/:id/purge',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  purgeDocument
);

// Soft delete → trash
router.delete(
  '/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  deleteDocument
);

export default router;