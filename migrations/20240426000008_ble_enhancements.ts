import { PoolClient } from 'pg';
import {
  addColumnIfNotExists,
  dropColumnIfExists,
  dropConstraintIfExists,
  constraintExists,
} from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await dropColumnIfExists(client, 'devices', 'firmware_version');
  await addColumnIfNotExists(client, 'devices', 'name', 'TEXT');
  await addColumnIfNotExists(client, 'devices', 'rssi_range', 'INT DEFAULT -70');

  // Expand presence_status CHECK to include transporting
  const hasCheck = await constraintExists(client, 'item_presence_state', 'item_presence_state_presence_status_check');
  if (hasCheck) {
    await client.query(`
      ALTER TABLE item_presence_state
      DROP CONSTRAINT item_presence_state_presence_status_check
    `);
  }
  await client.query(`
    ALTER TABLE item_presence_state
    ADD CONSTRAINT item_presence_state_presence_status_check
    CHECK (presence_status IN ('present', 'missing', 'inactive', 'maintenance', 'unknown', 'transporting'))
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await dropColumnIfExists(client, 'devices', 'rssi_range');
  await dropColumnIfExists(client, 'devices', 'name');
  // firmware_version intentionally not restored

  await dropConstraintIfExists(client, 'item_presence_state', 'item_presence_state_presence_status_check');
  await client.query(`
    ALTER TABLE item_presence_state
    ADD CONSTRAINT item_presence_state_presence_status_check
    CHECK (presence_status IN ('present', 'missing', 'inactive', 'maintenance', 'unknown'))
  `);
}
