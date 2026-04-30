import { PoolClient } from 'pg';
import { addColumnIfNotExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await addColumnIfNotExists(client, 'ble_tags', 'name', 'TEXT');
}

export async function down(client: PoolClient): Promise<void> {
  // No rollback needed; name is permanent
}
