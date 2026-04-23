import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../utils/db';
import { ForbiddenError } from '../utils/errors';

function getUserContext(req: AuthRequest) {
  const user = req.user;
  if (!user) throw new ForbiddenError();
  const isAdmin = user.roles.includes('admin');
  const isStaff = user.roles.includes('staff');
  return { userId: user.id, isAdmin, isStaff };
}

export async function getDashboardStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Dashboard access requires staff or admin role');
    }

    const itemCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM items WHERE deleted_at IS NULL`);
    const documentCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM documents WHERE deleted_at IS NULL`);
    const checkoutCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM checkout_transactions`);
    const missingCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM item_presence_state WHERE presence_status = 'missing'`);
    const offlineCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM devices WHERE is_active = true AND offline_since IS NOT NULL`);
    const activeDeviceCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM devices WHERE is_active = true AND offline_since IS NULL`);
    const userCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM users WHERE deleted_at IS NULL`);
    const roomCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM rooms`);

    res.json({
      stats: {
        items: parseInt(itemCount.rows[0].count, 10),
        documents: parseInt(documentCount.rows[0].count, 10),
        checkouts: parseInt(checkoutCount.rows[0].count, 10),
        missingItems: parseInt(missingCount.rows[0].count, 10),
        offlineDevices: parseInt(offlineCount.rows[0].count, 10),
        activeDevices: parseInt(activeDeviceCount.rows[0].count, 10),
        users: parseInt(userCount.rows[0].count, 10),
        rooms: parseInt(roomCount.rows[0].count, 10),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getRecentActivity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Dashboard access requires staff or admin role');
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    // Unified recent activity from audit_logs, document_activity_logs, and checkout_transactions
    const result = await query<{
      id: string;
      source: string;
      actor_id: string | null;
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      metadata: Record<string, unknown> | null;
      created_at: Date;
    }>(`
      (
        SELECT al.id::text, 'audit' as source, al.actor_id::text, al.action, al.entity_type, al.entity_id::text, al.after_state as metadata, al.created_at
        FROM audit_logs al
        ORDER BY al.created_at DESC
        LIMIT $1
      )
      UNION ALL
      (
        SELECT dal.id::text, 'document' as source, dal.actor_id::text, dal.action, 'document' as entity_type, dal.document_id::text, dal.metadata, dal.created_at
        FROM document_activity_logs dal
        ORDER BY dal.created_at DESC
        LIMIT $1
      )
      UNION ALL
      (
        SELECT ct.id::text, 'checkout' as source, ct.checked_out_by::text as actor_id, 'checkout' as action, 'checkout_transaction' as entity_type, ct.id::text as entity_id, jsonb_build_object('status', ct.status, 'notes', ct.notes) as metadata, ct.created_at
        FROM checkout_transactions ct
        ORDER BY ct.created_at DESC
        LIMIT $1
      )
      ORDER BY created_at DESC
      LIMIT $1
    `, [safeLimit]);

    res.json({ activity: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function getRoomStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Dashboard access requires staff or admin role');
    }

    const result = await query<{
      room_id: string;
      room_name: string;
      present_count: string;
      device_count: string;
      offline_device_count: string;
    }>(`
      SELECT
        r.id as room_id,
        r.name as room_name,
        COALESCE(p.present_count, 0)::text as present_count,
        COALESCE(d.device_count, 0)::text as device_count,
        COALESCE(doff.offline_device_count, 0)::text as offline_device_count
      FROM rooms r
      LEFT JOIN (
        SELECT current_room_id, COUNT(*) as present_count
        FROM item_presence_state
        WHERE presence_status = 'present'
        GROUP BY current_room_id
      ) p ON p.current_room_id = r.id
      LEFT JOIN (
        SELECT room_id, COUNT(*) as device_count
        FROM devices
        WHERE is_active = true
        GROUP BY room_id
      ) d ON d.room_id = r.id
      LEFT JOIN (
        SELECT room_id, COUNT(*) as offline_device_count
        FROM devices
        WHERE is_active = true AND offline_since IS NOT NULL
        GROUP BY room_id
      ) doff ON doff.room_id = r.id
      ORDER BY r.name
    `);

    res.json({
      rooms: result.rows.map((r) => ({
        room_id: r.room_id,
        room_name: r.room_name,
        present_count: parseInt(r.present_count, 10),
        device_count: parseInt(r.device_count, 10),
        offline_device_count: parseInt(r.offline_device_count, 10),
      })),
    });
  } catch (err) {
    next(err);
  }
}
