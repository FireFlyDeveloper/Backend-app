import { query } from '../utils/db';
import { config } from '../utils/config';
import {
  Room,
  Device,
  BleTag,
  ItemPresenceState,
  ItemLocationHistory,
  BleScanPayload,
} from '../types/ble';
import { NotFoundError, ValidationError } from '../utils/errors';
import { broadcast } from './websocketService';

// ======================= Rooms =======================

export async function listRooms(): Promise<Room[]> {
  const result = await query<Room>('SELECT * FROM rooms ORDER BY name');
  return result.rows;
}

export async function getRoomById(id: string): Promise<Room> {
  const result = await query<Room>('SELECT * FROM rooms WHERE id = $1', [id]);
  if (result.rows.length === 0) throw new NotFoundError('Room not found');
  return result.rows[0];
}

export async function createRoom(data: { name: string; building?: string; floor?: number; description?: string }): Promise<Room> {
  const result = await query<Room>(
    `INSERT INTO rooms (name, building, floor, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.name, data.building ?? null, data.floor ?? null, data.description ?? null]
  );
  return result.rows[0];
}

// ======================= Devices =======================

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
export async function listDevices(): Promise<Device[]> {
  const result = await query<Device>(
    `SELECT d.*, r.name as room_name
     FROM devices d
     LEFT JOIN rooms r ON r.id = d.room_id
     ORDER BY d.device_code`
  );
  return result.rows;
}

export async function getDeviceById(id: string): Promise<Device> {
  const result = await query<Device>('SELECT * FROM devices WHERE id = $1', [id]);
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return result.rows[0];
}

export async function getDeviceByCode(device_code: string): Promise<Device | null> {
  const result = await query<Device>('SELECT * FROM devices WHERE device_code = $1', [device_code]);
  return result.rows[0] ?? null;
}

export async function createDevice(data: { device_code: string; room_id?: string | null; label?: string }): Promise<Device> {
  const result = await query<Device>(
    `INSERT INTO devices (device_code, room_id, label)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.device_code, data.room_id ?? null, data.label ?? null]
  );
  return result.rows[0];
}

export async function updateDeviceRoom(id: string, room_id: string | null): Promise<Device> {
  const result = await query<Device>(
    `UPDATE devices SET room_id = $1 WHERE id = $2 RETURNING *`,
    [room_id, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return result.rows[0];
}

export async function updateDeviceLabel(id: string, label: string): Promise<Device> {
  const result = await query<Device>(
    `UPDATE devices SET label = $1 WHERE id = $2 RETURNING *`,
    [label, id]
  );
  if (result.rows.length === 0) throw new NotFoundError('Device not found');
  return result.rows[0];
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

// ======================= BLE Tags =======================

export async function listBleTags(): Promise<BleTag[]> {
  const result = await query<BleTag>(
    `SELECT bt.*, i.name as item_name
     FROM ble_tags bt
     LEFT JOIN items i ON i.id = bt.item_id
     ORDER BY bt.tag_code`
  );
  return result.rows;
}

export async function getBleTagById(id: string): Promise<BleTag> {
  const result = await query<BleTag>('SELECT * FROM ble_tags WHERE id = $1', [id]);
  if (result.rows.length === 0) throw new NotFoundError('BLE tag not found');
  return result.rows[0];
}

export async function getBleTagByCode(tag_code: string): Promise<BleTag | null> {
  const result = await query<BleTag>('SELECT * FROM ble_tags WHERE tag_code = $1', [tag_code]);
  return result.rows[0] ?? null;
}

export async function createBleTag(data: { tag_code: string; item_id?: string | null; assigned_by?: string | null }): Promise<BleTag> {
  const result = await query<BleTag>(
    `INSERT INTO ble_tags (tag_code, item_id, assigned_at, assigned_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.tag_code, data.item_id ?? null, data.item_id ? new Date() : null, data.assigned_by ?? null]
  );
  return result.rows[0];
}


export async function updateBleTag(id: string, data: { tag_code?: string; name?: string }): Promise<BleTag> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.tag_code !== undefined) { sets.push(`tag_code = $${idx++}`); values.push(data.tag_code); }
  if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }

  if (sets.length === 0) throw new ValidationError("No fields to update");
  values.push(id);

  const result = await query<BleTag>(
    `UPDATE ble_tags SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (result.rows.length === 0) throw new NotFoundError("Tag not found");
  return result.rows[0];
}
export async function assignTagToItem(tagId: string, itemId: string, assignedBy: string): Promise<BleTag> {
  // Unassign any existing tag from this item
  await query(
    `UPDATE ble_tags SET item_id = NULL, assigned_at = NULL, assigned_by = NULL
     WHERE item_id = $1 AND id != $2`,
    [itemId, tagId]
  );

  const result = await query<BleTag>(
    `UPDATE ble_tags
     SET item_id = $1, assigned_at = NOW(), assigned_by = $2
     WHERE id = $3 RETURNING *`,
    [itemId, assignedBy, tagId]
  );
  if (result.rows.length === 0) throw new NotFoundError('BLE tag not found');
  return result.rows[0];
}

export async function unassignTag(tagId: string): Promise<BleTag> {
  const result = await query<BleTag>(
    `UPDATE ble_tags
     SET item_id = NULL, assigned_at = NULL, assigned_by = NULL
     WHERE id = $1 RETURNING *`,
    [tagId]
  );
  if (result.rows.length === 0) throw new NotFoundError('BLE tag not found');
  return result.rows[0];
}

export async function softDeleteBleTag(id: string): Promise<void> {
  await query(`UPDATE ble_tags SET is_active = false WHERE id = $1`, [id]);
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
  const { device_code, tag_code, rssi } = payload;

  // Resolve device
  const device = await getDeviceByCode(device_code);
  if (!device) {
    // Rule 6 partial: device unknown — cannot log because device_events.device_id is NOT NULL.
    return;
  }

  if (!device.is_active) return; // ignore inactive devices

  // Resolve tag
  const tag = await getBleTagByCode(tag_code);

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
    broadcast({ type: 'unregistered_tag', tag_code, device_code, rssi, room_id: device.room_id, timestamp: new Date().toISOString() });
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
      conflict_meta: { rule: 7, reason: `item_status_${itemStatus}` },
    });
    broadcast({ type: 'item_status', item_id: tag.item_id, status: itemStatus, timestamp: new Date().toISOString() });
    return;
  }

  // Current presence state
  const currentPresence = await getPresenceByItemId(tag.item_id);

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
      conflict_meta: { rule: 1 },
    });
    broadcast({ type: 'item_location', item_id: tag.item_id, room_id: device.room_id, presence_status: 'present', rssi, timestamp: new Date().toISOString() });
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
        conflict_meta: { rule: 2, reason: 'lower_rssi_rejected', winner_room_id: currentPresence.current_room_id, winner_rssi: currentPresence.last_rssi },
      });
      return;
    }
    // New room wins (higher RSSI or outside window)
  }

  // Update presence state (room may be same or changed after conflict resolution)
  const roomChanged = currentPresence.current_room_id !== device.room_id;
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
    conflict_meta: roomChanged ? { rule: 2, reason: 'room_changed' } : null,
  });

  broadcast({
    type: 'item_location',
    item_id: tag.item_id,
    room_id: device.room_id,
    presence_status: 'present',
    rssi,
    timestamp: new Date().toISOString(),
  });
}

// ======================= Background Jobs =======================

export async function runMissingDetectionJob(): Promise<void> {
  const thresholdMs = config.bleMissingThresholdMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - thresholdMs);

  const result = await query<{ item_id: string }>(
    `SELECT item_id FROM item_presence_state
     WHERE presence_status = 'present'
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

    broadcast({ type: 'item_missing', item_id: row.item_id, timestamp: new Date().toISOString() });
  }
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

    broadcast({ type: 'device_offline', device_id: device.id, device_code: device.device_code, timestamp: new Date().toISOString() });
  }
}

// ======================= Presence Queries =======================

export async function listPresenceStates(): Promise<ItemPresenceState[]> {
  const result = await query<ItemPresenceState>(
    `SELECT ips.*, i.name as item_name, r.name as room_name
     FROM item_presence_state ips
     JOIN items i ON i.id = ips.item_id
     LEFT JOIN rooms r ON r.id = ips.current_room_id
     ORDER BY i.name`
  );
  return result.rows;
}

export async function getLocationHistory(itemId: string, limit = 100): Promise<ItemLocationHistory[]> {
  const result = await query<ItemLocationHistory>(
    `SELECT ilh.*, r.name as room_name, d.device_code
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
