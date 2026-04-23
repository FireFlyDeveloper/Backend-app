import { Router } from 'express';
import { authenticate, requireAdmin, requireRoles } from '../middleware/auth';
import {
  getBleTags,
  getBleTag,
  postBleTag,
  putAssignTag,
  putUnassignTag,
  deleteBleTag,
  getPresence,
  getHistory,
} from '../controllers/bleController';

const router = Router();

// Admin only for tag registration / assignment
router.post('/', authenticate, requireAdmin, postBleTag);
router.put('/:id/assign', authenticate, requireAdmin, putAssignTag);
router.put('/:id/unassign', authenticate, requireAdmin, putUnassignTag);
router.delete('/:id', authenticate, requireAdmin, deleteBleTag);

// Staff can view
router.get('/', authenticate, requireRoles('admin', 'staff'), getBleTags);
router.get('/:id', authenticate, requireRoles('admin', 'staff'), getBleTag);

// Presence & history
router.get('/presence', authenticate, requireRoles('admin', 'staff'), getPresence);
router.get('/history/:itemId', authenticate, requireRoles('admin', 'staff'), getHistory);

export default router;
