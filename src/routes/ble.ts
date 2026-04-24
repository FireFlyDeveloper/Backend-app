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
import {
  getRooms,
  getRoom,
  postRoom,
  getDevices,
  getDevice,
  postDevice,
  putDeviceRoom,
  putDeviceLabel,
  deleteDevice,
} from '../controllers/deviceController';
import { patchRoom, deleteRoom } from '../controllers/deviceController';


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
router.patch('/devices/:id', authenticate, requireAdmin, putDeviceLabel);
router.delete('/devices/:id', authenticate, requireAdmin, deleteDevice);

// ─── BLE Tags ───────────────────────────────────────────
router.get('/tags', authenticate, requireRoles('admin', 'staff'), getBleTags);
router.get('/tags/:id', authenticate, requireRoles('admin', 'staff'), getBleTag);
router.post('/tags', authenticate, requireAdmin, postBleTag);
router.patch('/tags/:id/assign', authenticate, requireAdmin, putAssignTag);
router.patch('/tags/:id/unassign', authenticate, requireAdmin, putUnassignTag);
router.delete('/tags/:id', authenticate, requireAdmin, deleteBleTag);

// ─── Presence & History ─────────────────────────────────
router.get('/presence', authenticate, requireRoles('admin', 'staff'), getPresence);
router.get('/presence/:itemId', authenticate, requireRoles('admin', 'staff'), getHistory);
router.get('/history/:itemId', authenticate, requireRoles('admin', 'staff'), getHistory);

export default router;
