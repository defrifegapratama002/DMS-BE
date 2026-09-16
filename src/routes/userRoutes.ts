import { Router } from 'express';
import { UserController } from '../controllers/userController.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { checkRole } from '../middlewares/checkRole.js';

const router = Router();

router.use(verifyToken);

// List users (admin only)
router.get(
  '/',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  UserController.getUsers
);

// Get user by ID
router.get(
  '/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  UserController.getUserById
);

// Create user (admin only)
router.post(
  '/',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  UserController.createUser
);

// Update user (admin only)
router.patch(
  '/:id',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  UserController.updateUser
);

// Delete user (admin only)
router.delete(
  '/:id',
  checkRole('SUPER_ADMIN'),
  UserController.deleteUser
);

// Reset password (admin only)
router.post(
  '/:id/reset-password',
  checkRole('SUPER_ADMIN', 'COMPANY_ADMIN'),
  UserController.resetPassword
);

export default router;