import { PoolClient } from 'pg';
import {
  addColumnIfNotExists,
  dropColumnIfExists,
  dropIndexIfExists,
  dropTriggerIfExists,
  indexExists,
  triggerExists,
} from '../scripts/migrationHelpers';

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at    TIMESTAMPTZ
    )
  `);

  if (!(await indexExists(client, 'idx_users_email'))) {
    await client.query(`CREATE INDEX idx_users_email ON users(email)`);
  }
  if (!(await indexExists(client, 'idx_users_deleted_at'))) {
    await client.query(`CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                       TEXT NOT NULL UNIQUE,
      description                TEXT,
      can_checkout_quantifiable  BOOLEAN NOT NULL DEFAULT false,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id      UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      assigned_by  UUID REFERENCES users(id),
      PRIMARY KEY (user_id, role_id)
    )
  `);

  if (!(await indexExists(client, 'idx_user_roles_user_id'))) {
    await client.query(`CREATE INDEX idx_user_roles_user_id ON user_roles(user_id)`);
  }
  if (!(await indexExists(client, 'idx_user_roles_role_id'))) {
    await client.query(`CREATE INDEX idx_user_roles_role_id ON user_roles(role_id)`);
  }

  await client.query(`
    INSERT INTO roles (name, description, can_checkout_quantifiable) VALUES
      ('admin',   'Full system access',                    true),
      ('staff',   'Inventory and document management',     true),
      ('student', 'Limited access per policy',             false)
    ON CONFLICT (name) DO NOTHING
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  if (!(await triggerExists(client, 'trg_users_updated_at', 'users'))) {
    await client.query(`
      CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }
}

export async function down(client: PoolClient): Promise<void> {
  await dropTriggerIfExists(client, 'trg_users_updated_at', 'users');
  await client.query(`DROP TABLE IF EXISTS user_roles CASCADE`);
  await client.query(`DROP TABLE IF EXISTS roles CASCADE`);
  await client.query(`DROP TABLE IF EXISTS users CASCADE`);
}
