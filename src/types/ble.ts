// --- BLE / Trackable Types ---

export interface Room {
  id: string;
  name: string;
  building: string | null;
  floor: number | null;
  description: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface Device {
  id: string;
  device_code: string;
  room_id: string | null;
  name: string | null;
  label: string | null;
  rssi_range: number | null;
  last_heartbeat: Date | null;
  offline_since: Date | null;
  is_active: boolean;
  created_at: Date;
}

export interface DeviceResponse {
  id: string;
  device_id: string;
  name: string;
  room_id: string | null;
  room_name: string | null;
  status: 'online' | 'offline';
  last_seen: string | null;
  rssi_range: number | null;
  created_at: string;
  updated_at: string;
}

export interface BleTag {
  id: string;
  tag_code: string;
  name: string | null;
  item_id: string | null;
  assigned_at: Date | null;
  assigned_by: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface ItemPresenceState {
  item_id: string;
  current_room_id: string | null;
  presence_status: 'present' | 'missing' | 'inactive' | 'maintenance' | 'unknown' | 'transporting';
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
  device_code?: string;
  tag_code?: string;
  anchor_id?: string;      // BLE gateway id (alternative to device_code)
  mac?: string;            // Beacon MAC address (alternative to tag_code)
  rssi: number;
  timestamp?: string | number;
  uuid?: string;
  major?: number;
  minor?: number;
  tx_power?: number;
  uptime?: number;
  wifi_rssi?: number;
}

export interface DeviceHeartbeatPayload {
  device_code?: string;
  anchor_id?: string;
  timestamp?: string | number;
}
