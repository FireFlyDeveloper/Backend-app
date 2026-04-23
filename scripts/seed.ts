import { query } from '../src/utils/db';
import { hashPassword } from '../src/utils/password';

async function seed() {
  const existing = await query(`SELECT id FROM users WHERE email = 'admin@local' AND deleted_at IS NULL`);
  if (existing.rows.length > 0) {
    console.log('Admin user already exists, skipping seed.');
    process.exit(0);
  }

  const passwordHash = await hashPassword('admin123');
  const userResult = await query(
    `INSERT INTO users (email, display_name, password_hash, is_active)
     VALUES ('admin@local', 'System Admin', $1, true)
     RETURNING id`,
    [passwordHash]
  );
  const userId = userResult.rows[0].id;

  const roleResult = await query(`SELECT id FROM roles WHERE name = 'admin'`);
  const roleId = roleResult.rows[0].id;

  await query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $1)`,
    [userId, roleId]
  );

  console.log('Seeded admin user: admin@local / admin123');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
