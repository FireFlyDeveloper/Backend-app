import { PoolClient } from 'pg';

/**
 * Safe helpers for idempotent schema changes.
 * Use these in migrations so they never crash on re-run or partial states.
 */

export async function columnExists(
  client: PoolClient,
  table: string,
  column: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return result.rows.length > 0;
}

export async function tableExists(
  client: PoolClient,
  table: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_name = $1`,
    [table]
  );
  return result.rows.length > 0;
}

export async function constraintExists(
  client: PoolClient,
  table: string,
  constraint: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = $1 AND constraint_name = $2`,
    [table, constraint]
  );
  return result.rows.length > 0;
}

export async function indexExists(
  client: PoolClient,
  index: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
    [index]
  );
  return result.rows.length > 0;
}

export async function triggerExists(
  client: PoolClient,
  trigger: string,
  table: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM pg_trigger WHERE tgname = $1 AND tgrelid = $2::regclass`,
    [trigger, table]
  );
  return result.rows.length > 0;
}

export async function addColumnIfNotExists(
  client: PoolClient,
  table: string,
  column: string,
  def: string
): Promise<void> {
  if (!(await columnExists(client, table, column))) {
    await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

export async function dropColumnIfExists(
  client: PoolClient,
  table: string,
  column: string
): Promise<void> {
  if (await columnExists(client, table, column)) {
    await client.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

export async function dropConstraintIfExists(
  client: PoolClient,
  table: string,
  constraint: string
): Promise<void> {
  if (await constraintExists(client, table, constraint)) {
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
  }
}

export async function dropIndexIfExists(
  client: PoolClient,
  index: string
): Promise<void> {
  if (await indexExists(client, index)) {
    await client.query(`DROP INDEX ${index}`);
  }
}

export async function dropTriggerIfExists(
  client: PoolClient,
  trigger: string,
  table: string
): Promise<void> {
  if (await triggerExists(client, trigger, table)) {
    await client.query(`DROP TRIGGER ${trigger} ON ${table}`);
  }
}
