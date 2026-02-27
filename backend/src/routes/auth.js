import express from 'express';
import {
  googleLogin,
  logout,
  verifyToken,
  getProfile,
  getUsers,
  addUser,
  removeUser,
} from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes (no authentication required)
router.post('/google-login', googleLogin);
router.post('/logout', logout);

// Protected routes (authentication required)
router.get('/verify', authenticateToken, verifyToken);
router.get('/profile', authenticateToken, getProfile);

// User management (protected)
router.get('/users', authenticateToken, getUsers);
router.post('/users', authenticateToken, addUser);
router.delete('/users/:id', authenticateToken, removeUser);

export default router;
