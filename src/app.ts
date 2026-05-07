import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import documentRoutes from './routes/documents';
import inventoryRoutes from './routes/inventory';
import bleRoutes from './routes/ble';
import deviceRoutes from './routes/devices';
import dashboardRoutes from './routes/dashboard';
import auditRoutes from './routes/audit';
import reportRoutes from './routes/reports';
import publicRoutes from './routes/public';
import onlyofficeRoutes from './routes/onlyoffice';
import { errorHandler } from './middleware/errorHandler';
import { initMqtt } from './services/mqttService';
import { initWebSocket } from './services/websocketService';
import { runMissingDetectionJob, runDeviceOfflineJob } from './services/bleService';
import { config } from './utils/config';
import { query } from './utils/db';

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/', publicRoutes);
app.use('/', onlyofficeRoutes);
app.use('/', documentRoutes);
app.use('/', inventoryRoutes);
app.use('/ble', bleRoutes);
app.use('/devices', deviceRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/audit-logs', auditRoutes);
app.use('/reports', reportRoutes);

// Route aliases for spec compliance
app.get('/inventory', (req, res) => res.redirect(307, '/items'));
app.get('/inventory/:id/lots', (req, res) => res.redirect(307, `/items/${req.params.id}/lots`));
app.get('/trackable/:id/state', (req, res) => res.redirect(307, `/ble/presence/${req.params.id}`));
app.get('/trackable/:id/history', (req, res) => res.redirect(307, `/ble/history/${req.params.id}`));
app.use('/ble-tags', (req, res) => res.redirect(307, '/ble/tags' + req.url));
app.use('/rooms', (req, res) => res.redirect(307, '/ble/rooms' + req.url));
app.get('/checkout/history', (req, res) => res.redirect(307, '/checkout'));

app.get('/health', async (_req, res) => {
  try {
    const dbResult = await query('SELECT 1 as ok');
    const dbHealthy = dbResult.rows.length > 0;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbHealthy ? 'connected' : 'disconnected',
      environment: config.nodeEnv,
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      environment: config.nodeEnv,
    });
  }
});

// Admin-only database maintenance endpoints
app.post('/admin/db/vacuum', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    // Import dynamically to avoid circular dependency issues at module load
    const { verifyToken } = await import('./utils/jwt');
    const { query: dbQuery } = await import('./utils/db');
    const payload = verifyToken(authHeader.slice(7));
    const userResult = await dbQuery(
      `SELECT ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = true`,
      [payload.id]
    );
    if (userResult.rows.length === 0 || !userResult.rows[0].roles?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
    }
    await dbQuery('VACUUM ANALYZE');
    res.json({ message: 'VACUUM ANALYZE completed' });
  } catch (err) {
    next(err);
  }
});

app.post('/admin/db/cleanup-soft-deletes', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const { verifyToken } = await import('./utils/jwt');
    const { query: dbQuery } = await import('./utils/db');
    const payload = verifyToken(authHeader.slice(7));
    const userResult = await dbQuery(
      `SELECT ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = true`,
      [payload.id]
    );
    if (userResult.rows.length === 0 || !userResult.rows[0].roles?.includes('admin')) {
      return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
    }

    const retentionDays = parseInt(req.query.retention_days as string || '30', 10);
    if (retentionDays < 1) {
      return res.status(400).json({ error: 'retention_days must be >= 1', code: 'VALIDATION_ERROR' });
    }

    const tables = ['users', 'items', 'documents', 'folders'];
    const results: Record<string, number> = {};

    for (const table of tables) {
      const r = await dbQuery(
        `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '${retentionDays} days'`
      );
      results[table] = r.rowCount || 0;
    }

    res.json({ message: 'Soft delete cleanup completed', deleted: results, retention_days: retentionDays });
  } catch (err) {
    next(err);
  }
});

app.use(errorHandler);

// Initialize MQTT and WebSocket when not in test mode
if (config.nodeEnv !== 'test') {
  initMqtt();
  initWebSocket();

  // Background jobs
  setInterval(() => {
    runMissingDetectionJob().catch((err) => console.error('[Job] Missing detection error:', err));
  }, config.missingJobIntervalSeconds * 1000);

  setInterval(() => {
    runDeviceOfflineJob().catch((err) => console.error('[Job] Device offline error:', err));
  }, config.bleHeartbeatIntervalSeconds * 1000);
}

export default app;
