import { Router } from 'express';
import {
  getFolderTree,
  getAllFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
} from '../controllers/folderController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';

const router = Router();

router.use(verifyToken);

router.get('/', getFolderTree);
router.get('/all', getAllFolders);

router.post(
  '/',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  createFolder
);

router.patch(
  '/:id/rename',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  renameFolder
);

router.patch(
  '/:id/move',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'),
  moveFolder
);

router.delete(
  '/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  deleteFolder
);

export default router;