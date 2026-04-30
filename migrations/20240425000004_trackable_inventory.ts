import { PoolClient } from 'pg';
import { indexExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL UNIQUE,
      building    TEXT,
      floor       INT,
      description TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at  TIMESTAMPTZ
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_code     TEXT NOT NULL UNIQUE,
      room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
      name            TEXT,
      label           TEXT,
      rssi_range      INT DEFAULT -70,
      last_heartbeat  TIMESTAMPTZ,
      offline_since   TIMESTAMPTZ,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_devices_room_id'))) {
    await client.query(`CREATE INDEX idx_devices_room_id ON devices(room_id)`);
  }
  if (!(await indexExists(client, 'idx_devices_active'))) {
    await client.query(`CREATE INDEX idx_devices_active ON devices(is_active)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS ble_tags (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tag_code    TEXT NOT NULL UNIQUE,
      name        TEXT,
      item_id     UUID REFERENCES items(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ,
      assigned_by UUID REFERENCES users(id),
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_ble_tags_item_id'))) {
    await client.query(`CREATE INDEX idx_ble_tags_item_id ON ble_tags(item_id) WHERE item_id IS NOT NULL`);
  }
  if (!(await indexExists(client, 'idx_ble_tags_code'))) {
    await client.query(`CREATE INDEX idx_ble_tags_code ON ble_tags(tag_code)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS item_presence_state (
      item_id          UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      current_room_id  UUID REFERENCES rooms(id) ON DELETE SET NULL,
      presence_status  TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (presence_status IN (
                         'present', 'missing', 'inactive', 'maintenance', 'unknown', 'transporting'
                       )),
      last_seen_at     TIMESTAMPTZ,
      last_device_id   UUID REFERENCES devices(id) ON DELETE SET NULL,
      last_rssi        INT,
      missing_since    TIMESTAMPTZ,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_presence_status'))) {
    await client.query(`CREATE INDEX idx_presence_status ON item_presence_state(presence_status)`);
  }
  if (!(await indexExists(client, 'idx_presence_room'))) {
    await client.query(`CREATE INDEX idx_presence_room ON item_presence_state(current_room_id)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS item_location_history (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
      device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
      presence_status TEXT NOT NULL,
      rssi            INT,
      conflict_meta   JSONB,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_location_history_item_id'))) {
    await client.query(`CREATE INDEX idx_location_history_item_id ON item_location_history(item_id)`);
  }
  if (!(await indexExists(client, 'idx_location_history_recorded_at'))) {
    await client.query(`CREATE INDEX idx_location_history_recorded_at ON item_location_history(recorded_at)`);
  }
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS item_location_history CASCADE`);
  await client.query(`DROP TABLE IF EXISTS item_presence_state CASCADE`);
  await client.query(`DROP TABLE IF EXISTS ble_tags CASCADE`);
  await client.query(`DROP TABLE IF EXISTS devices CASCADE`);
  await client.query(`DROP TABLE IF EXISTS rooms CASCADE`);
}
