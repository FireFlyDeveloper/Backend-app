import { PoolClient } from 'pg';
import { indexExists, triggerExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS items (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_type   TEXT NOT NULL CHECK (item_type IN ('trackable', 'quantifiable')),
      name        TEXT NOT NULL,
      category    TEXT,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'maintenance')),
      created_by  UUID NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at  TIMESTAMPTZ
    )
  `);

  if (!(await indexExists(client, 'idx_items_type'))) {
    await client.query(`CREATE INDEX idx_items_type ON items(item_type) WHERE deleted_at IS NULL`);
  }
  if (!(await indexExists(client, 'idx_items_status'))) {
    await client.query(`CREATE INDEX idx_items_status ON items(status) WHERE deleted_at IS NULL`);
  }
  if (!(await indexExists(client, 'idx_items_category'))) {
    await client.query(`CREATE INDEX idx_items_category ON items(category) WHERE deleted_at IS NULL`);
  }

  if (!(await triggerExists(client, 'trg_items_updated_at', 'items'))) {
    await client.query(`
      CREATE TRIGGER trg_items_updated_at
      BEFORE UPDATE ON items
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS items CASCADE`);
}
