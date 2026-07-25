import { Router } from 'express';
import {
  createFolder,
  getFolderContents,
  renameFolder,
  moveFolder,
  deleteFolder,
} from '../controllers/folderController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';
import { validateBody } from '../middlewares/validate.js';
import { createFolderSchema, renameFolderSchema, moveFolderSchema } from '../schemas/folderSchemas.js';

const router = Router();

router.use(verifyToken);

router.post('/', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(createFolderSchema), createFolder);
router.get('/:folderId', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'AUDITOR', 'EMPLOYEE'), getFolderContents);
router.patch('/:id/rename', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(renameFolderSchema), renameFolder);
router.patch('/:id/move', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'), validateBody(moveFolderSchema), moveFolder);
router.delete('/:id', checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'), deleteFolder);

export default router;