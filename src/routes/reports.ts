import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  getInventoryMovementReport,
  getCheckoutHistoryReport,
  getMissingHistoryReport,
  getDeviceHealthReport,
} from '../controllers/reportController';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/inventory-movement', getInventoryMovementReport);
router.get('/checkout-history', getCheckoutHistoryReport);
router.get('/missing-history', getMissingHistoryReport);
router.get('/device-health', getDeviceHealthReport);

export default router;
