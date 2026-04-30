import { PoolClient } from 'pg';
import { addColumnIfNotExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await addColumnIfNotExists(client, 'rooms', 'deleted_at', 'TIMESTAMPTZ');
}

export async function down(client: PoolClient): Promise<void> {
  // Keep deleted_at; dropping it would break soft-delete queries
}
