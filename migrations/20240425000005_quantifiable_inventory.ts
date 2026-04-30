import { PoolClient } from 'pg';
import { indexExists, triggerExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS item_lots (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id          UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      lot_code         TEXT NOT NULL,
      quantity_total   INT NOT NULL CHECK (quantity_total >= 0),
      quantity_on_hand INT NOT NULL CHECK (quantity_on_hand >= 0),
      quantity_out     INT NOT NULL DEFAULT 0 CHECK (quantity_out >= 0),
      purchased_at     DATE,
      expires_at       DATE,
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (item_id, lot_code),
      CONSTRAINT quantities_valid CHECK (quantity_on_hand + quantity_out <= quantity_total)
    )
  `);

  if (!(await indexExists(client, 'idx_item_lots_item_id'))) {
    await client.query(`CREATE INDEX idx_item_lots_item_id ON item_lots(item_id)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS checkout_transactions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      checked_out_by  UUID NOT NULL REFERENCES users(id),
      processed_by    UUID REFERENCES users(id),
      status          TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'partially_returned', 'closed', 'cancelled')),
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_checkout_status'))) {
    await client.query(`CREATE INDEX idx_checkout_status ON checkout_transactions(status)`);
  }
  if (!(await indexExists(client, 'idx_checkout_user'))) {
    await client.query(`CREATE INDEX idx_checkout_user ON checkout_transactions(checked_out_by)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS checkout_transaction_items (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id    UUID NOT NULL REFERENCES checkout_transactions(id) ON DELETE CASCADE,
      item_id           UUID NOT NULL REFERENCES items(id),
      lot_id            UUID NOT NULL REFERENCES item_lots(id),
      quantity_out      INT NOT NULL CHECK (quantity_out > 0),
      quantity_returned INT NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT return_not_exceed_out CHECK (quantity_returned <= quantity_out)
    )
  `);

  if (!(await indexExists(client, 'idx_cti_transaction'))) {
    await client.query(`CREATE INDEX idx_cti_transaction ON checkout_transaction_items(transaction_id)`);
  }
  if (!(await indexExists(client, 'idx_cti_item'))) {
    await client.query(`CREATE INDEX idx_cti_item ON checkout_transaction_items(item_id)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS return_transactions (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      checkout_transaction_id  UUID NOT NULL REFERENCES checkout_transactions(id),
      returned_by              UUID NOT NULL REFERENCES users(id),
      processed_by             UUID REFERENCES users(id),
      notes                    TEXT,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await indexExists(client, 'idx_return_txn_checkout'))) {
    await client.query(`CREATE INDEX idx_return_txn_checkout ON return_transactions(checkout_transaction_id)`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS return_transaction_items (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      return_transaction_id UUID NOT NULL REFERENCES return_transactions(id) ON DELETE CASCADE,
      checkout_item_id      UUID NOT NULL REFERENCES checkout_transaction_items(id),
      quantity_returned     INT NOT NULL CHECK (quantity_returned > 0),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!(await triggerExists(client, 'trg_item_lots_updated_at', 'item_lots'))) {
    await client.query(`
      CREATE TRIGGER trg_item_lots_updated_at
      BEFORE UPDATE ON item_lots
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }

  if (!(await triggerExists(client, 'trg_checkout_transactions_updated_at', 'checkout_transactions'))) {
    await client.query(`
      CREATE TRIGGER trg_checkout_transactions_updated_at
      BEFORE UPDATE ON checkout_transactions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS return_transaction_items CASCADE`);
  await client.query(`DROP TABLE IF EXISTS return_transactions CASCADE`);
  await client.query(`DROP TABLE IF EXISTS checkout_transaction_items CASCADE`);
  await client.query(`DROP TABLE IF EXISTS checkout_transactions CASCADE`);
  await client.query(`DROP TABLE IF EXISTS item_lots CASCADE`);
}
