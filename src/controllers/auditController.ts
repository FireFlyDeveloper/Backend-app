import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../utils/db';
import { ForbiddenError, ValidationError } from '../utils/errors';

function getUserContext(req: AuthRequest) {
  const user = req.user;
  if (!user) throw new ForbiddenError();
  const isAdmin = user.roles.includes('admin');
  const isStaff = user.roles.includes('staff');
  return { userId: user.id, isAdmin, isStaff };
}

export async function getAuditLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Audit log access requires staff or admin role');
    }

    const {
      entity_type,
      entity_id,
      actor_id,
      action,
      date_from,
      date_to,
      page,
      limit,
    } = req.query;

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (entity_type) {
      conditions.push(`entity_type = $${idx++}`);
      values.push(entity_type as string);
    }
    if (entity_id) {
      conditions.push(`entity_id = $${idx++}`);
      values.push(entity_id as string);
    }
    if (actor_id) {
      conditions.push(`actor_id = $${idx++}`);
      values.push(actor_id as string);
    }
    if (action) {
      conditions.push(`action = $${idx++}`);
      values.push(action as string);
    }
    if (date_from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(date_from as string);
    }
    if (date_to) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(date_to as string);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const pageNum = page ? parseInt(page as string, 10) : 1;
    const limitNum = limit ? parseInt(limit as string, 10) : 50;
    if (pageNum < 1) throw new ValidationError('page must be >= 1');
    if (limitNum < 1 || limitNum > 200) throw new ValidationError('limit must be between 1 and 200');
    const offset = (pageNum - 1) * limitNum;

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM audit_logs ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await query(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limitNum, offset]
    );

    // Map to frontend expected shape
    const logs = result.rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      action: r.action,
      actorId: r.actor_id,
      actorName: r.actor_id || 'System',
      entityId: r.entity_id,
      metadata: r.after_state || r.before_state || null,
      createdAt: r.created_at,
    }));

    res.json({
      logs,
      total,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAuditSummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Audit log access requires staff or admin role');
    }

    const { group_by } = req.query;
    const groupField = group_by === 'action' ? 'action' : 'entity_type';

    const result = await query<{ field: string; count: string }>(
      `SELECT ${groupField} as field, COUNT(*)::text as count FROM audit_logs GROUP BY ${groupField} ORDER BY count DESC`
    );

    const summary = result.rows.map((r) => ({
      [groupField]: r.field,
      count: parseInt(r.count, 10),
    }));

    res.json({
      summary,
    });
  } catch (err) {
    next(err);
  }
}
