-- Migration 4: Trackable Inventory

CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  building    TEXT,
  floor       INT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code     TEXT NOT NULL UNIQUE,
  room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
  label           TEXT,
  last_heartbeat  TIMESTAMPTZ,
  offline_since   TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_room_id ON devices(room_id);
CREATE INDEX idx_devices_active ON devices(is_active);

CREATE TABLE IF NOT EXISTS ble_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_code    TEXT NOT NULL UNIQUE,
  item_id     UUID REFERENCES items(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES users(id),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ble_tags_item_id ON ble_tags(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX idx_ble_tags_code ON ble_tags(tag_code);

CREATE TABLE IF NOT EXISTS item_presence_state (
  item_id          UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  current_room_id  UUID REFERENCES rooms(id) ON DELETE SET NULL,
  presence_status  TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (presence_status IN (
                     'present', 'missing', 'inactive', 'maintenance', 'unknown'
                   )),
  last_seen_at     TIMESTAMPTZ,
  last_device_id   UUID REFERENCES devices(id) ON DELETE SET NULL,
  last_rssi        INT,
  missing_since    TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_presence_status ON item_presence_state(presence_status);
CREATE INDEX idx_presence_room ON item_presence_state(current_room_id);

CREATE TABLE IF NOT EXISTS item_location_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  presence_status TEXT NOT NULL,
  rssi            INT,
  conflict_meta   JSONB,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_location_history_item_id ON item_location_history(item_id);
CREATE INDEX idx_location_history_recorded_at ON item_location_history(recorded_at);
