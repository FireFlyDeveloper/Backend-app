import { PoolClient } from 'pg';
import { indexExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
      action       TEXT NOT NULL,
      entity_type  TEXT NOT NULL,
      entity_id    UUID,
      before_state JSONB,
      after_state  JSONB,
      ip_address   INET,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_audit_entity'))) {
    await client.query(`CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id)`);
  }
  if (!(await indexExists(client, 'idx_audit_actor'))) {
    await client.query(`CREATE INDEX idx_audit_actor ON audit_logs(actor_id)`);
  }
  if (!(await indexExists(client, 'idx_audit_created_at'))) {
    await client.query(`CREATE INDEX idx_audit_created_at ON audit_logs(created_at)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS device_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      tag_id      UUID REFERENCES ble_tags(id) ON DELETE SET NULL,
      tag_code    TEXT NOT NULL,
      room_id     UUID REFERENCES rooms(id) ON DELETE SET NULL,
      rssi        INT,
      event_type  TEXT NOT NULL DEFAULT 'sighting'
                  CHECK (event_type IN ('sighting', 'heartbeat', 'error')),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_device_events_device'))) {
    await client.query(`CREATE INDEX idx_device_events_device ON device_events(device_id)`);
  }
  if (!(await indexExists(client, 'idx_device_events_tag'))) {
    await client.query(`CREATE INDEX idx_device_events_tag ON device_events(tag_code)`);
  }
  if (!(await indexExists(client, 'idx_device_events_recorded'))) {
    await client.query(`CREATE INDEX idx_device_events_recorded ON device_events(recorded_at)`);
  }
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS device_events CASCADE`);
  await client.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);
}
