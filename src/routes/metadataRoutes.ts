import { Router } from 'express';
import {
  TagController,
  DocumentTypeController,
  CorrespondentController,
} from '../controllers/metadataController.js';
import { CustomFieldController } from '../controllers/customFieldController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';

const router = Router();
router.use(verifyToken);

// ============ Tags ============
router.get('/tags', TagController.list);
router.post(
  '/tags',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  TagController.create
);
router.patch(
  '/tags/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  TagController.update
);
router.delete(
  '/tags/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  TagController.delete
);

// ============ Document Types ============
router.get('/document-types', DocumentTypeController.list);
router.post(
  '/document-types',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  DocumentTypeController.create
);
router.patch(
  '/document-types/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  DocumentTypeController.update
);
router.delete(
  '/document-types/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  DocumentTypeController.delete
);

// ============ Correspondents ============
router.get('/correspondents', CorrespondentController.list);
router.post(
  '/correspondents',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  CorrespondentController.create
);
router.patch(
  '/correspondents/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  CorrespondentController.update
);
router.delete(
  '/correspondents/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  CorrespondentController.delete
);

// ============ Custom Fields ============
router.get('/custom-fields', CustomFieldController.list);
router.post(
  '/custom-fields',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  CustomFieldController.create
);
router.patch(
  '/custom-fields/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  CustomFieldController.update
);
router.delete(
  '/custom-fields/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  CustomFieldController.remove
);

export default router;