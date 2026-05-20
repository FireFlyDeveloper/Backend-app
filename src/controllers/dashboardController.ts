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

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function formatDescription(
  action: string,
  entityType: string | null,
  metadata: Record<string, unknown> | null
): string {
  if (!metadata || typeof metadata !== 'object') {
    return `${capitalize(action)} ${entityType || 'record'}`;
  }

  const meta = metadata as Record<string, unknown>;
  const name =
    (meta.name as string) ||
    (meta.title as string) ||
    (meta.filename as string) ||
    (meta.device_code as string) ||
    (meta.username as string) ||
    (meta.email as string);

  const itemType = meta.item_type ? ` (${meta.item_type})` : '';
  const status = meta.status ? ` — ${meta.status}` : '';
  const rawNotes = typeof meta.notes === 'string' ? meta.notes : '';
  // Try to parse JSON notes (e.g. student info from public borrow)
  let notesStr = '';
  if (rawNotes.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawNotes);
      if (parsed.name) notesStr = ` by ${parsed.name}`;
      else if (parsed.srcode) notesStr = ` (SR-Code: ${parsed.srcode})`;
    } catch {
      notesStr = rawNotes ? `: ${rawNotes}` : '';
    }
  } else {
    notesStr = rawNotes ? `: ${rawNotes}` : '';
  }
  const size =
    typeof meta.size === 'number'
      ? ` (${(meta.size / 1024).toFixed(1)} KB${meta.mime_type ? `, ${meta.mime_type}` : ''})`
      : meta.mime_type
        ? ` (${meta.mime_type})`
        : '';

  switch (true) {
    case action === 'create' && entityType === 'item':
      return `Created item${name ? `: ${name}` : ''}${itemType}`;
    case action === 'update' && entityType === 'item':
      return `Updated item${name ? `: ${name}` : ''}`;
    case action === 'delete' && entityType === 'item':
      return `Deleted item${name ? `: ${name}` : ''}`;
    case action === 'checkout':
      return `Checkout transaction${status}${notesStr}`;
    case action === 'upload' || (action === 'create' && entityType === 'document'):
      return `Uploaded document${name ? `: ${name}` : ''}${size}`;
    case action === 'download':
      return `Downloaded document${name ? `: ${name}` : ''}`;
    case action === 'create' && entityType === 'user':
      return `Created user${name ? `: ${name}` : ''}`;
    case action === 'update' && entityType === 'user':
      return `Updated user${name ? `: ${name}` : ''}`;
    case action === 'delete' && entityType === 'user':
      return `Deleted user${name ? `: ${name}` : ''}`;
    case action === 'create' && entityType === 'device':
      return `Registered device${name ? `: ${name}` : ''}`;
    case action === 'update' && entityType === 'device':
      return `Updated device${name ? `: ${name}` : ''}`;
    case action === 'delete' && entityType === 'device':
      return `Removed device${name ? `: ${name}` : ''}`;
    case action === 'login':
      return `User logged in${name ? `: ${name}` : ''}`;
    case action === 'logout':
      return `User logged out${name ? `: ${name}` : ''}`;
    default:
      return `${capitalize(action)} ${entityType || 'record'}${name ? `: ${name}` : ''}`;
  }
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
    const activeCheckoutCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM checkout_transactions WHERE status = 'open'`);
    const userCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM users WHERE deleted_at IS NULL`);

    // Expiration KPIs
    const expiredCount = await query<{ count: string }>(`SELECT COUNT(DISTINCT item_id)::text as count FROM item_lots WHERE quantity_on_hand > 0 AND expires_at < CURRENT_DATE`);
    const expiringSoonCount = await query<{ count: string }>(`SELECT COUNT(DISTINCT item_id)::text as count FROM item_lots WHERE quantity_on_hand > 0 AND expires_at >= CURRENT_DATE AND expires_at < CURRENT_DATE + INTERVAL '7 days'`);
    const expiringMonthCount = await query<{ count: string }>(`SELECT COUNT(DISTINCT item_id)::text as count FROM item_lots WHERE quantity_on_hand > 0 AND expires_at >= CURRENT_DATE AND expires_at < CURRENT_DATE + INTERVAL '30 days'`);
    const quantifiableTotalCount = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM items WHERE item_type = 'quantifiable' AND deleted_at IS NULL`);

    res.json({
      stats: {
        totalItems: parseInt(itemCount.rows[0].count, 10),
        totalDocuments: parseInt(documentCount.rows[0].count, 10),
        totalUsers: parseInt(userCount.rows[0].count, 10),
        missingItemsCount: parseInt(missingCount.rows[0].count, 10),
        offlineDevicesCount: parseInt(offlineCount.rows[0].count, 10),
        recentCheckoutsCount: parseInt(checkoutCount.rows[0].count, 10),
        activeCheckoutsCount: parseInt(activeCheckoutCount.rows[0].count, 10),
        expirationKpis: {
          expired: parseInt(expiredCount.rows[0].count, 10),
          expiringSoon: parseInt(expiringSoonCount.rows[0].count, 10),
          expiringMonth: parseInt(expiringMonthCount.rows[0].count, 10),
          safe: parseInt(quantifiableTotalCount.rows[0].count, 10) - parseInt(expiringMonthCount.rows[0].count, 10) - parseInt(expiredCount.rows[0].count, 10),
        }
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

    // Map to frontend expected shape
    // Resolve actor names from users table
    const actorIds = [...new Set(result.rows.map((r) => r.actor_id).filter(Boolean))];
    const actorMap: Record<string, string> = {};
    if (actorIds.length > 0) {
      const placeholders = actorIds.map((_, i) => `$${i + 1}`).join(',');
      const userResult = await query<{ id: string; display_name: string }>(
        `SELECT id::text, display_name FROM users WHERE id IN (${placeholders})`
      , actorIds);
      for (const u of userResult.rows) {
        actorMap[u.id] = u.display_name;
      }
    }

    const activity = result.rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type || r.source,
      action: r.action,
      actorName: r.actor_id ? (actorMap[r.actor_id] || r.actor_id.slice(0, 8) + '...') : 'System',
      description: r.metadata ? formatDescription(r.action, r.entity_type, r.metadata) : '',
      createdAt: r.created_at,
    }));

    res.json({ activity });
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
      item_count: string;
      present_count: string;
      missing_count: string;
    }>(`
      SELECT
        r.id as room_id,
        r.name as room_name,
        COALESCE(i.item_count, 0)::text as item_count,
        COALESCE(p.present_count, 0)::text as present_count,
        COALESCE(m.missing_count, 0)::text as missing_count
      FROM rooms r
      LEFT JOIN (
        SELECT current_room_id, COUNT(*) as item_count
        FROM item_presence_state
        GROUP BY current_room_id
      ) i ON i.current_room_id = r.id
      LEFT JOIN (
        SELECT current_room_id, COUNT(*) as present_count
        FROM item_presence_state
        WHERE presence_status = 'present'
        GROUP BY current_room_id
      ) p ON p.current_room_id = r.id
      LEFT JOIN (
        SELECT current_room_id, COUNT(*) as missing_count
        FROM item_presence_state
        WHERE presence_status = 'missing'
        GROUP BY current_room_id
      ) m ON m.current_room_id = r.id
      ORDER BY r.name
    `);

    res.json({
      rooms: result.rows.map((r) => ({
        roomId: r.room_id,
        roomName: r.room_name,
        itemCount: parseInt(r.item_count, 10),
        presentCount: parseInt(r.present_count, 10),
        missingCount: parseInt(r.missing_count, 10),
      })),
    });
  } catch (err) {
    next(err);
  }
}
