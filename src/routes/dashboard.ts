import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getDashboardStats,
  getRecentActivity,
  getRoomStatus,
} from '../controllers/dashboardController';

const router = Router();

router.use(authenticate, requireRoles('admin', 'staff'));

router.get('/stats', getDashboardStats);
router.get('/recent-activity', getRecentActivity);
router.get('/room-status', getRoomStatus);

export default router;
