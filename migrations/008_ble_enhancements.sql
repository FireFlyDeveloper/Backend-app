-- Migration 8: BLE Enhancements — remove firmware_version, add name + rssi_range, add transporting status

-- Remove firmware_version from devices
ALTER TABLE devices DROP COLUMN IF EXISTS firmware_version;

-- Add human-readable name to devices
ALTER TABLE devices ADD COLUMN IF NOT EXISTS name TEXT;

-- Add per-device RSSI threshold (for small rooms, dynamic adjustment)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rssi_range INT DEFAULT -70;

-- Update presence_status CHECK to include 'transporting'
ALTER TABLE item_presence_state DROP CONSTRAINT IF EXISTS item_presence_state_presence_status_check;
ALTER TABLE item_presence_state ADD CONSTRAINT item_presence_state_presence_status_check
  CHECK (presence_status IN ('present', 'missing', 'inactive', 'maintenance', 'unknown', 'transporting'));
