import { PoolClient } from 'pg';
import { dropConstraintIfExists } from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await dropConstraintIfExists(client, 'checkout_transactions', 'checkout_transactions_status_check');

  await client.query(`
    ALTER TABLE checkout_transactions
    ADD CONSTRAINT checkout_transactions_status_check
    CHECK (status IN ('pending_approval', 'open', 'partially_returned', 'closed', 'cancelled', 'rejected'))
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await dropConstraintIfExists(client, 'checkout_transactions', 'checkout_transactions_status_check');

  await client.query(`
    ALTER TABLE checkout_transactions
    ADD CONSTRAINT checkout_transactions_status_check
    CHECK (status IN ('open', 'partially_returned', 'closed', 'cancelled'))
  `);
}
