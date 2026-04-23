import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import {
  getAuditLogs,
  getAuditSummary,
} from '../controllers/auditController';

const router = Router();

router.use(authenticate, requireRoles('admin', 'staff'));

router.get('/', getAuditLogs);
router.get('/summary', getAuditSummary);

export default router;
