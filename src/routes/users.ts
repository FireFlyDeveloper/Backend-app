import { Router } from 'express';
import {
  getUsers,
  getUser,
  postUser,
  patchUser,
  deleteUser,
  postUserRole,
  deleteUserRole,
  getRoles,
} from '../controllers/userController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/', getUsers);
router.post('/', postUser);
router.get('/roles', getRoles);
router.get('/:id', getUser);
router.patch('/:id', patchUser);
router.delete('/:id', deleteUser);
router.post('/:id/roles', postUserRole);
router.delete('/:id/roles/:rid', deleteUserRole);

export default router;
