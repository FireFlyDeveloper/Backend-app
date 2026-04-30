import { PoolClient } from 'pg';
import { indexExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE items
    ADD COLUMN IF NOT EXISTS sku TEXT
  `);

  if (!(await indexExists(client, 'idx_items_sku'))) {
    await client.query(`
      CREATE UNIQUE INDEX idx_items_sku ON items(sku)
      WHERE sku IS NOT NULL AND deleted_at IS NULL
    `);
  }
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP INDEX IF EXISTS idx_items_sku`);
  await client.query(`ALTER TABLE items DROP COLUMN IF EXISTS sku`);
}
