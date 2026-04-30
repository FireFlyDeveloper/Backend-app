import fs from 'fs';
import path from 'path';
import { PoolClient } from 'pg';
import pool from '../src/utils/db';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

interface MigrationFile {
  name: string;
  filepath: string;
  timestamp: string;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY name'
  );
  return new Set(result.rows.map((r) => r.name));
}

async function recordMigration(client: PoolClient, name: string): Promise<void> {
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
}

async function unrecordMigration(client: PoolClient, name: string): Promise<void> {
  await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
}

function listMigrationFiles(): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => {
      const timestamp = f.match(/^(\d{14})_/)?.[1] ?? f;
      return { name: f, filepath: path.join(MIGRATIONS_DIR, f), timestamp };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return files;
}

async function runMigration(file: MigrationFile, direction: 'up' | 'down'): Promise<void> {
  const mod = require(file.filepath);
  const fn = mod[direction];
  if (typeof fn !== 'function') {
    throw new Error(`Migration ${file.name} does not export ${direction}()`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    if (direction === 'up') {
      await recordMigration(client, file.name);
    } else {
      await unrecordMigration(client, file.name);
    }
    await client.query('COMMIT');
    console.log(`[migrate] ${direction.toUpperCase()}  ${file.name}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    client.release();

    const files = listMigrationFiles();
    let ran = 0;
    for (const file of files) {
      if (!applied.has(file.name)) {
        await runMigration(file, 'up');
        ran++;
      }
    }

    if (ran === 0) {
      console.log('[migrate] No pending migrations');
    } else {
      console.log(`[migrate] Applied ${ran} migration(s)`);
    }
  } catch (e) {
    client.release();
    console.error('[migrate] Error:', e);
    process.exit(1);
  }
}

async function rollback(steps = 1): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = Array.from(await getAppliedMigrations(client));
    client.release();

    const files = listMigrationFiles();
    const appliedFiles = files.filter((f) => applied.includes(f.name));
    const toRollback = appliedFiles.slice(-steps).reverse();

    if (toRollback.length === 0) {
      console.log('[migrate] Nothing to rollback');
      return;
    }

    for (const file of toRollback) {
      await runMigration(file, 'down');
    }
    console.log(`[migrate] Rolled back ${toRollback.length} migration(s)`);
  } catch (e) {
    client.release();
    console.error('[migrate] Rollback error:', e);
    process.exit(1);
  }
}

async function status(): Promise<void> {
  const client = await pool.connect();
  await ensureMigrationsTable(client);
  const applied = await getAppliedMigrations(client);
  client.release();

  const files = listMigrationFiles();
  console.log('\nMigration Status');
  console.log('----------------');
  for (const file of files) {
    const mark = applied.has(file.name) ? '✓' : ' ';
    console.log(` [${mark}] ${file.name}`);
  }
  console.log();
}

async function create(name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name}.ts`;
  const filepath = path.join(MIGRATIONS_DIR, filename);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  const template = `import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // TODO: implement migration
}

export async function down(client: PoolClient): Promise<void> {
  // TODO: implement rollback
}
`;

  fs.writeFileSync(filepath, template);
  console.log(`[migrate] Created ${filepath}`);
}

// CLI
const cmd = process.argv[2];
const arg = process.argv[3];

(async () => {
  try {
    if (cmd === 'rollback') {
      await rollback(Number(arg) || 1);
    } else if (cmd === 'status') {
      await status();
    } else if (cmd === 'create') {
      if (!arg) {
        console.error('Usage: npm run migrate create <name>');
        process.exit(1);
      }
      await create(arg);
    } else {
      await migrate();
    }
    await pool.end();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
