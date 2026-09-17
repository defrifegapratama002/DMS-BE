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
  updateDocumentStatus,
  moveDocument,
  getDocumentFile,
  getDocumentContent,
  getDocumentHistory,
  getSimilarDocuments,
} from '../controllers/documentController.js';
import { NoteController } from '../controllers/noteController.js';
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

// Catatan: hapus berdasarkan id catatan (statis, di atas /:id)
router.delete(
  '/notes/:noteId',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  NoteController.remove
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

// ✅ Status workflow (TAMBAHAN INI YANG KURANG)
router.patch(
  '/:id/status',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  updateDocumentStatus
);

router.post(
  '/:id/versions',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  upload.single('file'),
  uploadNewVersion
);

router.get('/:id/versions', getDocumentVersions);

// Berkas asli (pratinjau / unduh), isi terindeks, riwayat, dokumen mirip
router.get('/:id/file', getDocumentFile);
router.get('/:id/content', getDocumentContent);
router.get('/:id/history', getDocumentHistory);
router.get('/:id/similar', getSimilarDocuments);

// Pindah folder
router.patch(
  '/:id/move',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  moveDocument
);

// Catatan dokumen
router.get('/:id/notes', NoteController.list);
router.post(
  '/:id/notes',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  NoteController.create
);

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