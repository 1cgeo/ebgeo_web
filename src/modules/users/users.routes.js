// Path: src/modules/users/users.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './users.controller.js';
import * as schemas from './users.schemas.js';

const router = Router();

// User routes (authenticated user manages their own profile)
router.get('/me', auth, ctrl.getProfile);
router.put('/me', auth, validate({ body: schemas.updateProfileSchema }), ctrl.updateProfile);
router.put('/me/password', auth, validate({ body: schemas.updatePasswordSchema }), ctrl.updatePassword);
router.get('/search', auth, validate({ query: schemas.searchQuerySchema }), ctrl.searchUsers);

// Admin routes (manage all users)
router.get('/', auth, requireAdmin, validate({ query: schemas.listUsersQuerySchema }), ctrl.listUsers);
router.post('/', auth, requireAdmin, validate({ body: schemas.createUserAdminSchema }), ctrl.createUser);
router.get('/:userId', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema }), ctrl.getUser);
router.put('/:userId', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema, body: schemas.updateUserAdminSchema }), ctrl.updateUser);
router.post('/:userId/reset-password', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema, body: schemas.resetPasswordSchema }), ctrl.resetPassword);
router.delete('/:userId', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema, query: schemas.deleteUserQuerySchema }), ctrl.deleteUser);
router.post('/:userId/reactivate', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema }), ctrl.reactivateUser);

export { router as usersRoutes };
