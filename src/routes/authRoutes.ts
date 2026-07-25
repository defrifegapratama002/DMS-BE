import { Router } from 'express';
import { register, login, refreshAccessToken, logout } from '../controllers/authController.js';
import { validateBody } from '../middlewares/validate.js';
import { registerSchema, loginSchema, refreshTokenSchema } from '../schemas/authSchemas.js';

const router = Router();

router.post('/register', validateBody(registerSchema), register);
router.post('/login', validateBody(loginSchema), login);
router.post('/refresh', validateBody(refreshTokenSchema), refreshAccessToken);
router.post('/logout', validateBody(refreshTokenSchema), logout);

export default router;