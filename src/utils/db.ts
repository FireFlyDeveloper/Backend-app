import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 300_000,    // 5 minutes — don't kill idle connections too fast
  connectionTimeoutMillis: 10_000, // 10s timeout for new connections
  // Keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 60_000,
});

pool.on('error', (err) => {
  console.error('DB pool error (non-fatal):', err.message);
  // Don't exit — the pool will recreate connections as needed
});

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default pool;
