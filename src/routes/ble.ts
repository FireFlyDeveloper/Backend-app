import { Router } from 'express';
import { authenticate, requireAdmin, requireRoles } from '../middleware/auth';
import {
  getBleTags,
  getBleTag,
  postBleTag,
  patchBleTag,
  putAssignTag,
  putUnassignTag,
  deleteBleTag,
  getPresence,
  getPresenceDetailController,
  getHistory,
} from '../controllers/bleController';
import {
  getRooms,
  getRoom,
  postRoom,
  patchRoom,
  deleteRoom,
  getDevices,
  getDevice,
  postDevice,
  patchDevice,
  deleteDevice,
} from '../controllers/deviceController';

const router = Router();

// ─── Rooms ──────────────────────────────────────────────
router.get('/rooms', authenticate, requireRoles('admin', 'staff'), getRooms);
router.get('/rooms/:id', authenticate, requireRoles('admin', 'staff'), getRoom);
router.post('/rooms', authenticate, requireAdmin, postRoom);
router.patch('/rooms/:id', authenticate, requireAdmin, patchRoom);
router.delete('/rooms/:id', authenticate, requireAdmin, deleteRoom);

// ─── BLE Gateway Devices ────────────────────────────────
router.get('/devices', authenticate, requireRoles('admin', 'staff'), getDevices);
router.get('/devices/:id', authenticate, requireRoles('admin', 'staff'), getDevice);
router.post('/devices', authenticate, requireAdmin, postDevice);
router.patch('/devices/:id', authenticate, requireAdmin, patchDevice);
router.delete('/devices/:id', authenticate, requireAdmin, deleteDevice);

// ─── BLE Tags ───────────────────────────────────────────
router.get('/tags', authenticate, requireRoles('admin', 'staff'), getBleTags);
router.get('/tags/:id', authenticate, requireRoles('admin', 'staff'), getBleTag);
router.post('/tags', authenticate, requireAdmin, postBleTag);
router.patch('/tags/:id', authenticate, requireAdmin, patchBleTag);
router.patch('/tags/:id/assign', authenticate, requireAdmin, putAssignTag);
router.post('/tags/:id/assign', authenticate, requireAdmin, putAssignTag);
router.patch('/tags/:id/unassign', authenticate, requireAdmin, putUnassignTag);
router.post('/tags/:id/unassign', authenticate, requireAdmin, putUnassignTag);
router.delete('/tags/:id', authenticate, requireAdmin, deleteBleTag);

// ─── Presence & History ─────────────────────────────────
router.get('/presence', authenticate, requireRoles('admin', 'staff'), getPresence);
router.get('/presence/:itemId', authenticate, requireRoles('admin', 'staff'), getPresenceDetailController);
router.get('/history/:itemId', authenticate, requireRoles('admin', 'staff'), getHistory);

export default router;
