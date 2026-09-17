import express from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  getCurrentUser,
  updateProfile,
  changePassword,
} from '../controllers/authController.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/logout', verifyToken, logout);
router.get('/me', verifyToken, getCurrentUser);
router.patch('/me', verifyToken, updateProfile);
router.post('/change-password', verifyToken, changePassword);

export default router;