import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../utils/db';
import { ForbiddenError, ValidationError } from '../utils/errors';

function getUserContext(req: AuthRequest) {
  const user = req.user;
  if (!user) throw new ForbiddenError();
  const isAdmin = user.roles.includes('admin');
  return { userId: user.id, isAdmin };
}

function parseDateRange(req: AuthRequest): { dateFrom?: string; dateTo?: string } {
  // Accept both camelCase (frontend) and snake_case (direct API)
  const { date_from, date_to, startDate, endDate } = req.query;
  return {
    dateFrom: (date_from || startDate) as string | undefined,
    dateTo: (date_to || endDate) as string | undefined,
  };
}

function formatExport(data: any[], format: string): { body: string; contentType: string } {
  if (format === 'csv') {
    if (data.length === 0) return { body: '', contentType: 'text/csv' };
    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',')
    );
    const body = [headers.join(','), ...rows].join('\n');
    return { body, contentType: 'text/csv' };
  }
  return { body: JSON.stringify(data, null, 2), contentType: 'application/json' };
}

// --- Inventory Movement Report ---

export async function getInventoryMovementReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin) throw new ForbiddenError('Admin access required');

    const { dateFrom, dateTo } = parseDateRange(req);
    const format = (req.query.format as string) || 'json';
    if (!['json', 'csv'].includes(format)) throw new ValidationError('format must be json or csv');

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (dateFrom) {
      conditions.push(`ct.created_at >= $${idx++}`);
      values.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`ct.created_at <= $${idx++}`);
      values.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT
        ct.id,
        ct.checked_out_by,
        u.display_name as checked_out_by_name,
        ct.status,
        ct.notes,
        ct.created_at,
        ct.updated_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'item_id', cti.item_id,
              'item_name', i.name,
              'lot_id', cti.lot_id,
              'lot_code', il.lot_code,
              'quantity_out', cti.quantity_out,
              'quantity_returned', cti.quantity_returned
            )
          ) FILTER (WHERE cti.id IS NOT NULL),
          '[]'::jsonb
        ) as items
      FROM checkout_transactions ct
      JOIN users u ON u.id = ct.checked_out_by
      LEFT JOIN checkout_transaction_items cti ON cti.transaction_id = ct.id
      LEFT JOIN items i ON i.id = cti.item_id
      LEFT JOIN item_lots il ON il.id = cti.lot_id
      ${whereClause}
      GROUP BY ct.id, u.display_name
      ORDER BY ct.created_at DESC`,
      values
    );

    if (format === 'csv') {
      const flat = result.rows.map((r) => ({
        id: r.id,
        checked_out_by: r.checked_out_by,
        checked_out_by_name: r.checked_out_by_name,
        status: r.status,
        notes: r.notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
        items: JSON.stringify(r.items),
      }));
      const { body, contentType } = formatExport(flat, 'csv');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'attachment; filename="inventory-movement.csv"');
      return res.send(body);
    }

    // Map to frontend expected shape
    const data = result.rows.map((r) => ({
      date: r.created_at,
      checkouts: r.status === 'open' || r.status === 'partially_returned' ? 1 : 0,
      returns: r.status === 'closed' ? 1 : 0,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// --- Checkout History Report ---

export async function getCheckoutHistoryReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin) throw new ForbiddenError('Admin access required');

    const { dateFrom, dateTo } = parseDateRange(req);
    const format = (req.query.format as string) || 'json';
    if (!['json', 'csv'].includes(format)) throw new ValidationError('format must be json or csv');

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (dateFrom) {
      conditions.push(`ct.created_at >= $${idx++}`);
      values.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`ct.created_at <= $${idx++}`);
      values.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT
        ct.id as transaction_id,
        ct.checked_out_by,
        u.display_name as checked_out_by_name,
        ct.status,
        ct.notes,
        ct.created_at as checkout_date,
        cti.id as checkout_item_id,
        cti.item_id,
        i.name as item_name,
        cti.lot_id,
        il.lot_code,
        cti.quantity_out,
        cti.quantity_returned,
        rt.id as return_transaction_id,
        rt.returned_by,
        ru.display_name as returned_by_name,
        rt.created_at as return_date,
        rti.quantity_returned as returned_quantity
      FROM checkout_transactions ct
      JOIN users u ON u.id = ct.checked_out_by
      LEFT JOIN checkout_transaction_items cti ON cti.transaction_id = ct.id
      LEFT JOIN items i ON i.id = cti.item_id
      LEFT JOIN item_lots il ON il.id = cti.lot_id
      LEFT JOIN return_transaction_items rti ON rti.checkout_item_id = cti.id
      LEFT JOIN return_transactions rt ON rt.id = rti.return_transaction_id
      LEFT JOIN users ru ON ru.id = rt.returned_by
      ${whereClause}
      ORDER BY ct.created_at DESC`,
      values
    );

    if (format === 'csv') {
      const { body, contentType } = formatExport(result.rows, 'csv');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'attachment; filename="checkout-history.csv"');
      return res.send(body);
    }

    // Map to frontend expected shape
    const data = result.rows.map((r) => ({
      id: r.transaction_id,
      checkedOutBy: r.checked_out_by_name || r.checked_out_by,
      processedBy: r.returned_by_name || null,
      status: r.status,
      notes: r.notes,
      createdAt: r.checkout_date,
      updatedAt: r.return_date || r.checkout_date,
      itemCount: r.quantity_out || 0,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// --- Missing History Report ---

export async function getMissingHistoryReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin) throw new ForbiddenError('Admin access required');

    const { dateFrom, dateTo } = parseDateRange(req);
    const format = (req.query.format as string) || 'json';
    if (!['json', 'csv'].includes(format)) throw new ValidationError('format must be json or csv');

    const conditions: string[] = [`presence_status = 'missing'`];
    const values: any[] = [];
    let idx = 1;

    if (dateFrom) {
      conditions.push(`missing_since >= $${idx++}`);
      values.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`missing_since <= $${idx++}`);
      values.push(dateTo);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = await query(
      `SELECT
        ips.item_id,
        i.name as item_name,
        ips.current_room_id,
        r.name as room_name,
        ips.missing_since,
        ips.last_seen_at,
        ips.last_device_id,
        d.device_code as last_device_code,
        ips.last_rssi,
        ips.updated_at
      FROM item_presence_state ips
      JOIN items i ON i.id = ips.item_id
      LEFT JOIN rooms r ON r.id = ips.current_room_id
      LEFT JOIN devices d ON d.id = ips.last_device_id
      ${whereClause}
      ORDER BY ips.missing_since DESC`,
      values
    );

    if (format === 'csv') {
      const { body, contentType } = formatExport(result.rows, 'csv');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'attachment; filename="missing-history.csv"');
      return res.send(body);
    }

    // Map to frontend expected shape
    const data = result.rows.map((r) => ({
      itemId: r.item_id,
      itemName: r.item_name,
      roomId: r.current_room_id,
      roomName: r.room_name,
      status: 'missing',
      lastSeen: r.last_seen_at,
      detectedAt: r.missing_since,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// --- Device Health Report ---

export async function getDeviceHealthReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin) throw new ForbiddenError('Admin access required');

    const { dateFrom, dateTo } = parseDateRange(req);
    const format = (req.query.format as string) || 'json';
    if (!['json', 'csv'].includes(format)) throw new ValidationError('format must be json or csv');

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (dateFrom) {
      conditions.push(`d.created_at >= $${idx++}`);
      values.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`d.created_at <= $${idx++}`);
      values.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT
        d.id,
        d.device_code,
        d.label,
        d.room_id,
        r.name as room_name,
        d.last_heartbeat,
        d.offline_since,
        d.is_active,
        d.created_at,
        CASE
          WHEN d.offline_since IS NOT NULL THEN 'offline'
          WHEN d.last_heartbeat IS NOT NULL THEN 'online'
          ELSE 'unknown'
        END as health_status,
        CASE
          WHEN d.offline_since IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - d.offline_since))::int
          WHEN d.last_heartbeat IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - d.last_heartbeat))::int
          ELSE NULL
        END as seconds_since_last_heartbeat
      FROM devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      ${whereClause}
      ORDER BY d.device_code`,
      values
    );

    if (format === 'csv') {
      const { body, contentType } = formatExport(result.rows, 'csv');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'attachment; filename="device-health.csv"');
      return res.send(body);
    }

    // Map to frontend expected shape
    const data = result.rows.map((r) => ({
      deviceId: r.id,
      deviceName: r.label || r.device_code,
      roomName: r.room_name,
      status: r.health_status,
      lastSeen: r.last_heartbeat || r.offline_since,
      uptimePercent: r.health_status === 'online' ? 100 : (r.health_status === 'offline' ? 0 : null),
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
}
