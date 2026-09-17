import { Router } from 'express';
import { ShareLinkController } from '../controllers/shareLinkController.js';

// Endpoint TANPA login — hanya untuk tautan publik (ShareLink).
const router = Router();

router.get('/share/:token', ShareLinkController.resolve);
router.get('/share/:token/file', ShareLinkController.file);

export default router;