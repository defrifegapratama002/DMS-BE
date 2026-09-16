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
import { DocumentMetaController } from '../controllers/metadataController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';
import { upload } from '../middlewares/upload.js';

const router = Router();

router.use(verifyToken);

// ⚠️ Route statis HARUS di atas route dinamis /:id
router.get('/trash', getTrash);
router.delete(
  '/trash',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  emptyTrash
);

router.post(
  '/bulk-meta',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  DocumentMetaController.bulkUpdateMeta
);

// Documents CRUD
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

// ✅ Metadata update
router.patch(
  '/:id/meta',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  DocumentMetaController.updateMeta
);

router.post(
  '/:id/versions',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  upload.single('file'),
  uploadNewVersion
);

router.get('/:id/versions', getDocumentVersions);

router.post('/:id/restore', restoreDocument);

router.delete(
  '/:id/purge',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  purgeDocument
);

router.delete(
  '/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  deleteDocument
);

export default router;