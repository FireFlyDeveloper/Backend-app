import { Router } from 'express';
import { authenticate, requireAdmin, requireRoles } from '../middleware/auth';
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
  postDeviceEvent,
} from '../controllers/deviceController';

const router = Router();

// Rooms
router.get('/rooms', authenticate, requireRoles('admin', 'staff'), getRooms);
router.get('/rooms/:id', authenticate, requireRoles('admin', 'staff'), getRoom);
router.post('/rooms', authenticate, requireAdmin, postRoom);

// Devices
router.get('/', authenticate, requireRoles('admin', 'staff'), getDevices);
router.get('/:id', authenticate, requireRoles('admin', 'staff'), getDevice);
router.post('/', authenticate, requireAdmin, postDevice);
router.put('/:id/room', authenticate, requireAdmin, putDeviceRoom);
router.put('/:id/label', authenticate, requireAdmin, putDeviceLabel);
router.delete('/:id', authenticate, requireAdmin, deleteDevice);

// REST ingestion (alias for MQTT payloads)
router.post('/events', authenticate, requireRoles('admin', 'staff'), postDeviceEvent);

export default router;
