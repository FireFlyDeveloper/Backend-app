// --- BLE / Trackable Types ---

export interface Room {
  id: string;
  name: string;
  building: string | null;
  floor: number | null;
  description: string | null;
  created_at: Date;
}

export interface Device {
  id: string;
  device_code: string;
  room_id: string | null;
  label: string | null;
  last_heartbeat: Date | null;
  offline_since: Date | null;
  is_active: boolean;
  created_at: Date;
}

export interface BleTag {
  id: string;
  tag_code: string;
  item_id: string | null;
  assigned_at: Date | null;
  assigned_by: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface ItemPresenceState {
  item_id: string;
  current_room_id: string | null;
  presence_status: 'present' | 'missing' | 'inactive' | 'maintenance' | 'unknown';
  last_seen_at: Date | null;
  last_device_id: string | null;
  last_rssi: number | null;
  missing_since: Date | null;
  updated_at: Date;
}

export interface ItemLocationHistory {
  id: string;
  item_id: string;
  room_id: string | null;
  device_id: string | null;
  presence_status: string;
  rssi: number | null;
  conflict_meta: Record<string, unknown> | null;
  recorded_at: Date;
}

export interface DeviceEvent {
  id: string;
  device_id: string;
  tag_id: string | null;
  tag_code: string;
  room_id: string | null;
  rssi: number | null;
  event_type: 'sighting' | 'heartbeat' | 'error';
  recorded_at: Date;
}

export interface BleScanPayload {
  device_code: string;
  tag_code: string;
  rssi: number;
  timestamp?: string; // ISO string from device
}

export interface DeviceHeartbeatPayload {
  device_code: string;
  timestamp?: string;
}
