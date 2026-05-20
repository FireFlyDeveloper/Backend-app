import { query } from '../utils/db';
import { config } from '../utils/config';
import {
  Room,
  Device,
  DeviceResponse,
  BleTag,
  ItemPresenceState,
  ItemLocationHistory,
  BleScanPayload,
} from '../types/ble';
import { NotFoundError, ValidationError } from '../utils/errors';
import { broadcast } from './websocketService';

// ======================= Response Mappers =======================

function toDeviceResponse(row: any): DeviceResponse {
  const isOnline = row.is_active && !row.offline_since;
  return {
    id: row.id,
    device_id: row.device_code,
    name: row.name || row.label || row.device_code,
    room_id: row.room_id || null,
    room_name: row.room_name || null,
    status: isOnline ? 'online' : 'offline',
    last_seen: row.last_heartbeat ? new Date(row.last_heartbeat).toISOString() : null,
    rssi_range: row.rssi_range ?? -70,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()),
  };
}

// ======================= Rooms =======================

export async function listRooms(): Promise<Room[]> {
  const result = await query<Room>('SELECT * FROM rooms WHERE deleted_at IS NULL ORDER BY name');
  return result.rows;
}

export async function getRoomById(id: string): Promise<Room> {
  const result = await query<Room>('SELECT * FROM rooms WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (result.rows.length === 0) throw new NotFoundError('Room not found');
  return result.rows[0];
}

export async function createRoom(data: { name: string; building?: string; floor?: number; description?: string }): Promise<Room> {
  const existing = await query<Room>('SELECT * FROM rooms WHERE name = $1', [data.name]);
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.deleted_at) {
      const result = await query<Room>(
        `UPDATE rooms
         SET deleted_at = NULL,
             building = $1,
             floor = $2,
             description = $3
         WHERE id = $4 RETURNING *`,
        [data.building ?? null, data.floor ?? null, data.description ?? null, row.id]
      );
      return result.rows[0];
    }
    throw new ValidationError(`Room name "${data.name}" already exists`);
  }

  const result = await query<Room>(
    `INSERT INTO rooms (name, building, floor, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.name, data.building ?? null, data.floor ?? null, data.description ?? null]
  );
  return result.rows[0];
}

export async function updateRoom(id: string, data: { name?: string; building?: string; floor?: number; description?: string }): Promise<Room> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
  if (data.building !== undefined) { sets.push(`building = $${idx++}`); values.push(data.building); }
  if (data.floor !== undefined) { sets.push(`floor = $${idx++}`); values.push(data.floor); }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); values.push(data.description); }

  if (sets.length === 0) throw new ValidationError('No fields to update');
  values.push(id);

  const result = await query<Room>(
    `UPDATE rooms SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (result.rows.length === 0) throw new NotFoundError('Room not found');
  return result.rows[0];
}

export async function softDeleteRoom(id: string): Promise<void> {
  const result = await query('UPDATE rooms SET deleted_at = NOW() WHERE id = $1', [id]);
  if (result.rowCount === 0) throw new NotFoundError('Room not found');
}

// ======================= Devices =======================

export async function listDevices(): Promise<DeviceResponse[]> {
  const result = await query<Device>(
    `SELECT d.*, r.name as room_name
     FROM devices d
     LEFT JOIN rooms r ON r.id = d.room_id
     WHERE d.is_active = true
     ORDER BY d.device_code`
  );
  return result.rows.map(toDeviceResponse);
}

export async function getDeviceById(id: string): Promise<DeviceResponse> {
  const result = await query<Device>(
    `SELECT d.*, r.name as room_name
     FROM devices d
     LEFT JOIN rooms r ON r.id = d.room_id
     WHERE d.id = $1`,
    [id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return toDeviceResponse(result.rows[0]);
}

export async function getDeviceByCode(device_code: string): Promise<Device | null> {
  const result = await query<Device>('SELECT * FROM devices WHERE device_code = $1', [device_code]);
  return result.rows[0] ?? null;
}

export async function createDevice(data: { device_code: string; room_id?: string | null; name?: string; label?: string; rssi_range?: number }): Promise<DeviceResponse> {
  // Check for existing device_code (including soft-deleted/inactive)
  const existing = await getDeviceByCode(data.device_code);
  if (existing) {
    if (!existing.is_active) {
      // Reactivate and apply new settings
      const result = await query<Device>(
        `UPDATE devices
         SET is_active = true,
             room_id = $1,
             name = $2,
             label = $3,
             rssi_range = $4,
             offline_since = NULL
         WHERE id = $5 RETURNING *`,
        [data.room_id ?? null, data.name ?? null, data.label ?? null, data.rssi_range ?? -70, existing.id]
      );
      return toDeviceResponse(result.rows[0]);
    }
    throw new ValidationError(`Device code "${data.device_code}" already exists`);
  }

  const result = await query<Device>(
    `INSERT INTO devices (device_code, room_id, name, label, rssi_range)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.device_code, data.room_id ?? null, data.name ?? null, data.label ?? null, data.rssi_range ?? -70]
  );
  return toDeviceResponse(result.rows[0]);
}

export async function updateDeviceRoom(id: string, room_id: string | null): Promise<DeviceResponse> {
  const result = await query<Device>(
    `UPDATE devices SET room_id = $1 WHERE id = $2 RETURNING *`,
    [room_id, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return getDeviceById(id);
}

export async function updateDeviceLabel(id: string, label: string): Promise<DeviceResponse> {
  const result = await query<Device>(
    `UPDATE devices SET label = $1 WHERE id = $2 RETURNING *`,
    [label, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return getDeviceById(id);
}

export async function updateDeviceName(id: string, name: string): Promise<DeviceResponse> {
  const result = await query<Device>(
    `UPDATE devices SET name = $1 WHERE id = $2 RETURNING *`,
    [name, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return getDeviceById(id);
}

export async function updateDeviceRssiRange(id: string, rssi_range: number): Promise<DeviceResponse> {
  const result = await query<Device>(
    `UPDATE devices SET rssi_range = $1 WHERE id = $2 RETURNING *`,
    [rssi_range, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return getDeviceById(id);
}

export async function softDeleteDevice(id: string): Promise<void> {
  await query(`UPDATE devices SET is_active = false WHERE id = $1`, [id]);
}

export async function recordDeviceHeartbeat(device_code: string): Promise<Device | null> {
  const device = await getDeviceByCode(device_code);
  if (!device) return null;

  const result = await query<Device>(
    `UPDATE devices
     SET last_heartbeat = NOW(), offline_since = NULL
     WHERE id = $1 RETURNING *`,
    [device.id]
  );
  return result.rows[0];
}

export async function markDeviceOffline(id: string): Promise<void> {
  await query(
    `UPDATE devices SET offline_since = NOW() WHERE id = $1 AND offline_since IS NULL`,
    [id]
  );
}

function toTagResponse(row: any): any {
  return {
    id: row.id,
    tag_id: row.tag_code,
    name: row.name || row.tag_code,
    item_id: row.item_id || null,
    item_name: row.item_name || null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()),
  }
}

// ======================= BLE Tags =======================

export async function listBleTags(): Promise<any[]> {
  const result = await query(
    `SELECT bt.*, i.name as item_name
     FROM ble_tags bt
     LEFT JOIN items i ON i.id = bt.item_id
     WHERE bt.is_active = true
     ORDER BY bt.tag_code`
  );
  return result.rows.map(toTagResponse);
}

export async function getBleTagById(id: string): Promise<any> {
  const result = await query('SELECT * FROM ble_tags WHERE id = $1', [id]);
  if (result.rows.length === 0) throw new NotFoundError('BLE tag not found');
  return toTagResponse(result.rows[0]);
}

export async function getBleTagByCode(tag_code: string): Promise<BleTag | null> {
  const result = await query<BleTag>('SELECT * FROM ble_tags WHERE tag_code = $1', [tag_code]);
  return result.rows[0] ?? null;
}

export async function createBleTag(data: { tag_code: string; item_id?: string | null; assigned_by?: string | null; name?: string }): Promise<any> {
  const existing = await getBleTagByCode(data.tag_code);
  if (existing) {
    if (!existing.is_active) {
      const result = await query(
        `UPDATE ble_tags
         SET is_active = true,
             name = $1,
             item_id = $2,
             assigned_at = $3,
             assigned_by = $4
         WHERE id = $5 RETURNING *`,
        [
          data.name ?? null,
          data.item_id ?? null,
          data.item_id ? new Date() : null,
          data.assigned_by ?? null,
          existing.id,
        ]
      );
      return toTagResponse(result.rows[0]);
    }
    throw new ValidationError(`Tag code "${data.tag_code}" already exists`);
  }

  const result = await query(
    `INSERT INTO ble_tags (tag_code, item_id, assigned_at, assigned_by, name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.tag_code, data.item_id ?? null, data.item_id ? new Date() : null, data.assigned_by ?? null, data.name ?? null]
  );
  return toTagResponse(result.rows[0]);
}

export async function updateBleTag(id: string, data: { tag_code?: string; name?: string }): Promise<any> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.tag_code !== undefined) { sets.push(`tag_code = $${idx++}`); values.push(data.tag_code); }
  if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }

  if (sets.length === 0) throw new ValidationError("No fields to update");
  values.push(id);

  const result = await query(
    `UPDATE ble_tags SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (result.rows.length === 0) throw new NotFoundError("Tag not found");
  return toTagResponse(result.rows[0]);
}

export async function assignTagToItem(tagId: string, itemId: string, assignedBy: string): Promise<any> {
  // Find the item this tag is currently assigned to (for Rule 5 cleanup)
  const oldTagResult = await query<{ item_id: string | null }>(
    'SELECT item_id FROM ble_tags WHERE id = $1',
    [tagId]
  );
  const oldItemId = oldTagResult.rows[0]?.item_id ?? null;

  // Unassign any existing tag from the NEW item (one tag per item)
  await query(
    `UPDATE ble_tags SET item_id = NULL, assigned_at = NULL, assigned_by = NULL
     WHERE item_id = $1 AND id != $2`,
    [itemId, tagId]
  );

  const result = await query(
    `UPDATE ble_tags
     SET item_id = $1, assigned_at = NOW(), assigned_by = $2
     WHERE id = $3 RETURNING *`,
    [itemId, assignedBy, tagId]
  );
  if (result.rows.length === 0) throw new NotFoundError('BLE tag not found');

  // Rule 5: Reset presence state for the OLD item when tag is reassigned
  if (oldItemId && oldItemId !== itemId) {
    await query(
      `UPDATE item_presence_state
       SET presence_status = 'unknown',
           current_room_id = NULL,
           last_device_id = NULL,
           last_rssi = NULL,
           missing_since = NULL,
           updated_at = NOW()
       WHERE item_id = $1`,
      [oldItemId]
    );

    await query(
      `INSERT INTO item_location_history
         (item_id, room_id, device_id, presence_status, rssi, conflict_meta)
       VALUES ($1, NULL, NULL, 'unknown', NULL, '{"note": "Tag reassigned to another item"}')`,
      [oldItemId]
    );
  }

  return toTagResponse(result.rows[0]);
}

export async function unassignTag(tagId: string): Promise<any> {
  // Get the old item_id before unassigning
  const oldResult = await query<{ item_id: string | null }>(
    'SELECT item_id FROM ble_tags WHERE id = $1',
    [tagId]
  );
  if (oldResult.rows.length === 0) throw new NotFoundError('BLE tag not found');

  const oldItemId = oldResult.rows[0].item_id;

  const result = await query(
    `UPDATE ble_tags
     SET item_id = NULL, assigned_at = NULL, assigned_by = NULL
     WHERE id = $1 RETURNING *`,
    [tagId]
  );

  // Reset presence state for the previously assigned item
  if (oldItemId) {
    await query(
      `UPDATE item_presence_state
       SET presence_status = 'unknown',
           current_room_id = NULL,
           last_device_id = NULL,
           last_rssi = NULL,
           missing_since = NULL,
           updated_at = NOW()
       WHERE item_id = $1`,
      [oldItemId]
    );

    await query(
      `INSERT INTO item_location_history
        (item_id, room_id, device_id, presence_status, rssi, conflict_meta)
       VALUES ($1, NULL, NULL, 'unknown', NULL, '{"note": "Tag unassigned from item"}')`,
      [oldItemId]
    );
  }

  return toTagResponse(result.rows[0]);
}

export async function softDeleteBleTag(id: string): Promise<void> {
  // Get the tag info first (what item it's assigned to)
  const tagResult = await query<{ item_id: string | null; tag_code: string }>(
    `SELECT item_id, tag_code FROM ble_tags WHERE id = $1 AND is_active = true`,
    [id]
  );
  if (tagResult.rows.length === 0) return;

  const tag = tagResult.rows[0];

  // Reset presence state for the previously assigned item
  if (tag.item_id) {
    await query(
      `UPDATE item_presence_state
       SET presence_status = 'unknown',
           current_room_id = NULL,
           last_device_id = NULL,
           last_rssi = NULL,
           missing_since = NULL,
           updated_at = NOW()
       WHERE item_id = $1`,
      [tag.item_id]
    );

    await query(
      `INSERT INTO item_location_history
        (item_id, room_id, device_id, presence_status, rssi, conflict_meta)
       VALUES ($1, NULL, NULL, 'unknown', NULL, '{"note": "Tag deleted — unassigned from item"}')`,
      [tag.item_id]
    );
  }

  // Soft-delete the tag: clear assignment and mark inactive
  await query(
    `UPDATE ble_tags
     SET is_active = false, item_id = NULL, assigned_at = NULL, assigned_by = NULL
     WHERE id = $1`,
    [id]
  );
}

// ======================= Presence State =======================

export async function getPresenceByItemId(itemId: string): Promise<ItemPresenceState | null> {
  const result = await query<ItemPresenceState>(
    `SELECT * FROM item_presence_state WHERE item_id = $1`,
    [itemId]
  );
  return result.rows[0] ?? null;
}

export async function upsertPresenceState(data: {
  item_id: string;
  current_room_id: string | null;
  presence_status: ItemPresenceState['presence_status'];
  last_seen_at: Date;
  last_device_id: string | null;
  last_rssi: number | null;
}): Promise<ItemPresenceState> {
  const result = await query<ItemPresenceState>(
    `INSERT INTO item_presence_state
       (item_id, current_room_id, presence_status, last_seen_at, last_device_id, last_rssi, missing_since)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)
     ON CONFLICT (item_id) DO UPDATE SET
       current_room_id = EXCLUDED.current_room_id,
       presence_status = EXCLUDED.presence_status,
       last_seen_at = EXCLUDED.last_seen_at,
       last_device_id = EXCLUDED.last_device_id,
       last_rssi = EXCLUDED.last_rssi,
       missing_since = NULL,
       updated_at = NOW()
     RETURNING *`,
    [data.item_id, data.current_room_id, data.presence_status, data.last_seen_at, data.last_device_id, data.last_rssi]
  );
  return result.rows[0];
}

export async function markItemMissing(itemId: string): Promise<void> {
  await query(
    `UPDATE item_presence_state
     SET presence_status = 'missing',
         missing_since = COALESCE(missing_since, NOW()),
         updated_at = NOW()
     WHERE item_id = $1`,
    [itemId]
  );
}

export async function markItemStatusFromItem(itemId: string, status: 'inactive' | 'maintenance'): Promise<void> {
  await query(
    `UPDATE item_presence_state
     SET presence_status = $1,
         updated_at = NOW()
     WHERE item_id = $2`,
    [status, itemId]
  );
}

// ======================= Location History =======================

export async function appendLocationHistory(data: {
  item_id: string;
  room_id: string | null;
  device_id: string | null;
  presence_status: string;
  rssi: number | null;
  conflict_meta?: Record<string, unknown> | null;
}): Promise<ItemLocationHistory> {
  const result = await query<ItemLocationHistory>(
    `INSERT INTO item_location_history
       (item_id, room_id, device_id, presence_status, rssi, conflict_meta)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.item_id, data.room_id, data.device_id, data.presence_status, data.rssi, data.conflict_meta ? JSON.stringify(data.conflict_meta) : null]
  );
  return result.rows[0];
}

// ======================= Device Events =======================

export async function logDeviceEvent(data: {
  device_id: string;
  tag_id?: string | null;
  tag_code: string;
  room_id?: string | null;
  rssi?: number | null;
  event_type: 'sighting' | 'heartbeat' | 'error';
}): Promise<void> {
  await query(
    `INSERT INTO device_events (device_id, tag_id, tag_code, room_id, rssi, event_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.device_id, data.tag_id ?? null, data.tag_code, data.room_id ?? null, data.rssi ?? null, data.event_type]
  );
}

// ======================= Audit Logging Helper =======================

export async function logAudit(data: {
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
}): Promise<void> {
  await query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.actor_id || null,
      data.action,
      data.entity_type,
      data.entity_id || null,
      data.before_state ? JSON.stringify(data.before_state) : null,
      data.after_state ? JSON.stringify(data.after_state) : null,
    ]
  );
}

// ======================= Conflict Resolution (Rules 1-7) =======================

export async function processBleScan(payload: BleScanPayload): Promise<void> {
  const device_code = payload.device_code?.replace(/\x00/g, '').trim();
  const tag_code = payload.tag_code?.replace(/\x00/g, '').trim();
  const rssi = payload.rssi;

  if (!device_code || !tag_code) {
    console.warn('[BLE] Missing device_code or tag_code in scan payload');
    return;
  }

  // Build metadata from extra payload fields for history logging
  const scanMeta: Record<string, unknown> = {};
  if (payload.uuid) scanMeta.uuid = payload.uuid.replace(/\x00/g, '').trim();
  if (payload.major !== undefined) scanMeta.major = payload.major;
  if (payload.minor !== undefined) scanMeta.minor = payload.minor;
  if (payload.tx_power !== undefined) scanMeta.tx_power = payload.tx_power;
  if (payload.uptime !== undefined) scanMeta.anchor_uptime = payload.uptime;
  if (payload.wifi_rssi !== undefined) scanMeta.wifi_rssi = payload.wifi_rssi;
  if (payload.timestamp !== undefined) scanMeta.device_timestamp = payload.timestamp;

  // Resolve device
  const device = await getDeviceByCode(device_code);
  if (!device) {
    // Rule 6 partial: device unknown — cannot log because device_events.device_id is NOT NULL.
    return;
  }

  if (!device.is_active) return; // ignore inactive devices

  // Resolve tag (by tag_code/mac first; fallback to uuid:major:minor synthetic key)
  let tag = await getBleTagByCode(tag_code);
  if (!tag && payload.uuid && payload.major !== undefined && payload.minor !== undefined) {
    const syntheticCode = `${payload.uuid.replace(/\x00/g, '').trim()}:${payload.major}:${payload.minor}`;
    tag = await getBleTagByCode(syntheticCode);
  }

  // Log raw event
  await logDeviceEvent({
    device_id: device.id,
    tag_id: tag?.id ?? null,
    tag_code,
    room_id: device.room_id,
    rssi,
    event_type: 'sighting',
  });

  // Rule 6: Unregistered tag logging
  if (!tag) {
    broadcast({ type: 'unregistered_tag', tag_id: tag_code, device_id: device_code, device_name: device.label || device.device_code, room_id: device.room_id, room_name: null, rssi, timestamp: new Date().toISOString() });
    return;
  }

  if (!tag.is_active) return; // inactive tag

  // Rule 5: Tag reassignment handling — if tag no longer assigned to an item, treat as unregistered
  if (!tag.item_id) {
    broadcast({ type: 'unassigned_tag', tag_id: tag.id, tag_code, device_code, rssi, room_id: device.room_id, timestamp: new Date().toISOString() });
    return;
  }

  // Fetch item to check status (Rule 7)
  const itemResult = await query(`SELECT status FROM items WHERE id = $1`, [tag.item_id]);
  if (itemResult.rows.length === 0) return; // orphan tag
  const itemStatus = itemResult.rows[0].status as string;

  if (itemStatus === 'inactive' || itemStatus === 'maintenance') {
    // Rule 7: Maintenance/inactive item handling
    await markItemStatusFromItem(tag.item_id, itemStatus as 'inactive' | 'maintenance');
    await appendLocationHistory({
      item_id: tag.item_id,
      room_id: device.room_id,
      device_id: device.id,
      presence_status: itemStatus,
      rssi,
      conflict_meta: { ...scanMeta, rule: 7, reason: `item_status_${itemStatus}` },
    });
    broadcast({ type: 'item_status', item_id: tag.item_id, status: itemStatus, timestamp: new Date().toISOString() });
    return;
  }

  // Guard: if the scanning device isn't assigned to a room, we can't determine location.
  // Log the raw event (already done above) but don't update presence state.
  if (!device.room_id) {
    return;
  }

  // Current presence state
  const currentPresence = await getPresenceByItemId(tag.item_id);
  const deviceRssiRange = device.rssi_range ?? -70;

  // RSSI threshold check for transporting / arrived logic
  const isWeakSignal = rssi < deviceRssiRange;

  if (isWeakSignal) {
    // Weak signal: if item is currently in this device's room, mark as transporting
    if (currentPresence && currentPresence.current_room_id === device.room_id) {
      await upsertPresenceState({
        item_id: tag.item_id,
        current_room_id: device.room_id,
        presence_status: 'transporting',
        last_seen_at: new Date(),
        last_device_id: device.id,
        last_rssi: rssi,
      });
      await appendLocationHistory({
        item_id: tag.item_id,
        room_id: device.room_id,
        device_id: device.id,
        presence_status: 'transporting',
        rssi,
        conflict_meta: { ...scanMeta, rule: 'rssi', reason: 'weak_signal_transporting', threshold: deviceRssiRange },
      });
      broadcast({ type: 'item_transporting', item_id: tag.item_id, room_id: device.room_id, rssi, timestamp: new Date().toISOString() });
    } else {
      // Weak signal from a different room — update last_seen so missing timer doesn't fire,
      // but don't change presence state or room.
      await query(
        `UPDATE item_presence_state
         SET last_seen_at = NOW(),
             last_device_id = $1,
             last_rssi = $2,
             updated_at = NOW()
         WHERE item_id = $3`,
        [device.id, rssi, tag.item_id]
      );
      await appendLocationHistory({
        item_id: tag.item_id,
        room_id: device.room_id,
        device_id: device.id,
        presence_status: currentPresence?.presence_status ?? 'unknown',
        rssi,
        conflict_meta: { ...scanMeta, rule: 'rssi', reason: 'weak_signal_ignored', threshold: deviceRssiRange, current_room_id: currentPresence?.current_room_id },
      });
    }
    return;
  }

  // Strong signal (rssi >= threshold)
  if (!currentPresence) {
    // Rule 1: New tag sighting → insert presence state
    await upsertPresenceState({
      item_id: tag.item_id,
      current_room_id: device.room_id,
      presence_status: 'present',
      last_seen_at: new Date(),
      last_device_id: device.id,
      last_rssi: rssi,
    });
    await appendLocationHistory({
      item_id: tag.item_id,
      room_id: device.room_id,
      device_id: device.id,
      presence_status: 'present',
      rssi,
      conflict_meta: { ...scanMeta, rule: 1, note: `item arrived to ${device.room_id}` },
    });
    broadcast({ type: 'item_location', item_id: tag.item_id, room_id: device.room_id, presence_status: 'present', rssi, device_id: device.id, device_name: device.label || device.device_code, timestamp: new Date().toISOString() });
    return;
  }

  // Rule 2: Same tag in multiple rooms → higher RSSI wins (within conflict window)
  if (
    currentPresence.current_room_id &&
    currentPresence.current_room_id !== device.room_id
  ) {
    const lastSeen = currentPresence.last_seen_at ? new Date(currentPresence.last_seen_at).getTime() : 0;
    const now = Date.now();
    const inWindow = (now - lastSeen) <= config.bleConflictWindowSeconds * 1000;

    if (inWindow && currentPresence.last_rssi !== null && rssi <= currentPresence.last_rssi) {
      // Current wins; log conflict
      await appendLocationHistory({
        item_id: tag.item_id,
        room_id: device.room_id,
        device_id: device.id,
        presence_status: 'present',
        rssi,
        conflict_meta: { ...scanMeta, rule: 2, reason: 'lower_rssi_rejected', winner_room_id: currentPresence.current_room_id, winner_rssi: currentPresence.last_rssi },
      });
      return;
    }
    // New room wins (higher RSSI or outside window)
  }

  // Update presence state (room may be same or changed after conflict resolution)
  const roomChanged = currentPresence.current_room_id !== device.room_id;
  const wasTransporting = currentPresence.presence_status === 'transporting';
  await upsertPresenceState({
    item_id: tag.item_id,
    current_room_id: device.room_id,
    presence_status: 'present',
    last_seen_at: new Date(),
    last_device_id: device.id,
    last_rssi: rssi,
  });

  const conflictMeta: Record<string, unknown> = roomChanged
    ? { ...scanMeta, rule: 2, reason: 'room_changed' }
    : { ...scanMeta };
  if (wasTransporting || roomChanged) {
    conflictMeta.note = `item arrived to ${device.room_id}`;
    conflictMeta.arrived = true;
  }

  await appendLocationHistory({
    item_id: tag.item_id,
    room_id: device.room_id,
    device_id: device.id,
    presence_status: 'present',
    rssi,
    conflict_meta: Object.keys(conflictMeta).length > 0 ? conflictMeta : null,
  });

  broadcast({
    type: 'item_location',
    item_id: tag.item_id,
    room_id: device.room_id,
    presence_status: 'present',
    rssi,
    device_id: device.id,
    device_name: device.label || device.device_code,
    timestamp: new Date().toISOString(),
  });
}

// ======================= Background Jobs =======================

export async function runMissingDetectionJob(): Promise<void> {
  const thresholdMs = config.bleMissingThresholdMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - thresholdMs);

  const result = await query<{ item_id: string }>(
    `SELECT item_id FROM item_presence_state
     WHERE presence_status IN ('present', 'transporting')
       AND last_seen_at < $1`,
    [cutoff]
  );

  for (const row of result.rows) {
    await markItemMissing(row.item_id);
    const presence = await getPresenceByItemId(row.item_id);
    await appendLocationHistory({
      item_id: row.item_id,
      room_id: presence?.current_room_id ?? null,
      device_id: presence?.last_device_id ?? null,
      presence_status: 'missing',
      rssi: presence?.last_rssi ?? null,
      conflict_meta: { rule: 3, reason: 'missing_threshold_exceeded' },
    });

    // Log to audit_logs
    await logAudit({
      action: 'item_missing',
      entity_type: 'item_presence_state',
      entity_id: row.item_id,
      after_state: {
        presence_status: 'missing',
        missing_since: new Date().toISOString(),
        last_room_id: presence?.current_room_id ?? null,
        last_device_id: presence?.last_device_id ?? null,
      },
    });

    broadcast({ type: 'item_missing', item_id: row.item_id, last_room_id: presence?.current_room_id ?? null, last_seen: presence?.last_seen_at ? new Date(presence.last_seen_at).toISOString() : null, timestamp: new Date().toISOString() });
  }

  // Clean up ghost presence states where device had no room assignment
  await query(
    `UPDATE item_presence_state
     SET presence_status = 'unknown',
         last_device_id = NULL,
         last_rssi = NULL,
         missing_since = NULL,
         updated_at = NOW()
     WHERE current_room_id IS NULL`
  );
}

export async function runDeviceOfflineJob(): Promise<void> {
  const thresholdMs = config.bleDeviceOfflineThresholdMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - thresholdMs);

  const result = await query<Device>(
    `SELECT * FROM devices
     WHERE is_active = true
       AND (last_heartbeat IS NULL OR last_heartbeat < $1)
       AND offline_since IS NULL`,
    [cutoff]
  );

  for (const device of result.rows) {
    await markDeviceOffline(device.id);

    // Log to audit_logs
    await logAudit({
      action: 'device_offline',
      entity_type: 'device',
      entity_id: device.id,
      after_state: {
        offline_since: new Date().toISOString(),
        last_heartbeat: device.last_heartbeat ? new Date(device.last_heartbeat).toISOString() : null,
        device_code: device.device_code,
        room_id: device.room_id,
      },
    });

    broadcast({ type: 'device_offline', device_id: device.id, device_name: device.label || device.device_code, room_id: device.room_id, last_seen: device.last_heartbeat ? new Date(device.last_heartbeat).toISOString() : null, timestamp: new Date().toISOString() });

    // Mark any 'transporting' items last seen by this device as missing
    // because there is no anchor left to track them.
    const transportingResult = await query<{ item_id: string }>(
      `SELECT item_id FROM item_presence_state
       WHERE last_device_id = $1
         AND presence_status = 'transporting'`,
      [device.id]
    );
    for (const row of transportingResult.rows) {
      await markItemMissing(row.item_id);
      const presence = await getPresenceByItemId(row.item_id);
      await appendLocationHistory({
        item_id: row.item_id,
        room_id: presence?.current_room_id ?? null,
        device_id: device.id,
        presence_status: 'missing',
        rssi: presence?.last_rssi ?? null,
        conflict_meta: { rule: 'device_offline', reason: 'anchor_went_offline_while_transporting' },
      });
      await logAudit({
        action: 'item_missing',
        entity_type: 'item_presence_state',
        entity_id: row.item_id,
        after_state: {
          presence_status: 'missing',
          missing_since: new Date().toISOString(),
          last_room_id: presence?.current_room_id ?? null,
          last_device_id: device.id,
          reason: 'anchor_offline_during_transport',
        },
      });
      broadcast({ type: 'item_missing', item_id: row.item_id, last_room_id: presence?.current_room_id ?? null, last_seen: presence?.last_seen_at ? new Date(presence.last_seen_at).toISOString() : null, timestamp: new Date().toISOString() });
    }
  }
}

// ======================= Presence Queries =======================

export async function listPresenceStates(): Promise<any[]> {
  const result = await query(
    `SELECT ips.*, i.name as item_name, r.name as room_name, d.label as device_name
     FROM item_presence_state ips
     JOIN items i ON i.id = ips.item_id AND i.deleted_at IS NULL
     LEFT JOIN rooms r ON r.id = ips.current_room_id AND r.deleted_at IS NULL
     LEFT JOIN devices d ON d.id = ips.last_device_id
     WHERE ips.current_room_id IS NOT NULL
     ORDER BY i.name`
  );
  return result.rows;
}

export async function getLocationHistory(itemId: string, limit = 100): Promise<any[]> {
  const result = await query(
    `SELECT ilh.id, ilh.item_id, ilh.room_id, r.name as room_name,
            ilh.device_id, d.device_code as device_name,
            ilh.presence_status, ilh.rssi, ilh.conflict_meta,
            ilh.recorded_at as detected_at
     FROM item_location_history ilh
     LEFT JOIN rooms r ON r.id = ilh.room_id
     LEFT JOIN devices d ON d.id = ilh.device_id
     WHERE ilh.item_id = $1
     ORDER BY ilh.recorded_at DESC
     LIMIT $2`,
    [itemId, limit]
  );
  return result.rows;
}

export async function getPresenceDetail(itemId: string): Promise<any> {
  const stateResult = await query(
    `SELECT ips.*, i.name as item_name, r.name as room_name, d.device_code as device_name
     FROM item_presence_state ips
     JOIN items i ON i.id = ips.item_id
     LEFT JOIN rooms r ON r.id = ips.current_room_id
     LEFT JOIN devices d ON d.id = ips.last_device_id
     WHERE ips.item_id = $1`,
    [itemId]
  );

  const historyResult = await query(
    `SELECT ilh.id, ilh.item_id, ilh.room_id, r.name as room_name,
            ilh.device_id, d.device_code as device_name,
            ilh.presence_status, ilh.rssi, ilh.conflict_meta,
            ilh.recorded_at as detected_at
     FROM item_location_history ilh
     LEFT JOIN rooms r ON r.id = ilh.room_id
     LEFT JOIN devices d ON d.id = ilh.device_id
     WHERE ilh.item_id = $1
     ORDER BY ilh.recorded_at DESC
     LIMIT 100`,
    [itemId]
  );

  const state = stateResult.rows[0];
  return {
    item_id: itemId,
    item_name: state?.item_name || null,
    room_id: state?.current_room_id || null,
    room_name: state?.room_name || null,
    status: state?.presence_status || 'unknown',
    last_seen: state?.last_seen_at || null,
    device_id: state?.last_device_id || null,
    device_name: state?.device_name || null,
    history: historyResult.rows,
  };
}
