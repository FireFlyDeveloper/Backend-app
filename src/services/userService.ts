import { query, withTransaction } from '../utils/db';
import { hashPassword } from '../utils/password';
import { SafeUser, User } from '../types';
import { NotFoundError, ConflictError } from '../utils/errors';

export async function listUsers(): Promise<SafeUser[]> {
  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
      ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.deleted_at IS NULL
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  );
  return result.rows.map((r) => ({
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    is_active: r.is_active,
    created_at: r.created_at,
    roles: r.roles || [],
  }));
}

export async function getUserById(id: string): Promise<SafeUser> {
  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
      ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [id]
  );
  if (result.rows.length === 0) throw new NotFoundError('User not found');
  const r = result.rows[0];
  return {
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    is_active: r.is_active,
    created_at: r.created_at,
    roles: r.roles || [],
  };
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await query(
    `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email]
  );
  return result.rows[0] || null;
}

export async function createUser(data: {
  email: string;
  display_name: string;
  password: string;
  is_active?: boolean;
}): Promise<SafeUser> {
  const existing = await query(`SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`, [data.email]);
  if (existing.rows.length > 0) throw new ConflictError('Email already in use');

  const passwordHash = await hashPassword(data.password);
  const result = await query(
    `INSERT INTO users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, display_name, is_active, created_at`,
    [data.email, data.display_name, passwordHash, data.is_active ?? true]
  );
  const r = result.rows[0];
  return {
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    is_active: r.is_active,
    created_at: r.created_at,
    roles: [],
  };
}

export async function updateUser(
  id: string,
  data: { display_name?: string; is_active?: boolean; password?: string }
): Promise<SafeUser> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.display_name !== undefined) {
    sets.push(`display_name = $${idx++}`);
    values.push(data.display_name);
  }
  if (data.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(data.is_active);
  }
  if (data.password) {
    sets.push(`password_hash = $${idx++}`);
    values.push(await hashPassword(data.password));
  }
  if (sets.length === 0) throw new Error('No fields to update');

  sets.push(`updated_at = now()`);
  values.push(id);

  const result = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING id`,
    values
  );
  if (result.rows.length === 0) throw new NotFoundError('User not found');
  return getUserById(id);
}

export async function softDeleteUser(id: string): Promise<void> {
  const result = await query(
    `UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rowCount === 0) throw new NotFoundError('User not found');
}

export async function assignRole(userId: string, roleId: string, assignedBy: string): Promise<void> {
  await withTransaction(async (client) => {
    const userCheck = await client.query(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    if (userCheck.rows.length === 0) throw new NotFoundError('User not found');

    const roleCheck = await client.query(`SELECT id FROM roles WHERE id = $1`, [roleId]);
    if (roleCheck.rows.length === 0) throw new NotFoundError('Role not found');

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, roleId, assignedBy]
    );
  });
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
  const result = await query(
    `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [userId, roleId]
  );
  if (result.rowCount === 0) throw new NotFoundError('Role assignment not found');
}

export async function listRoles(): Promise<{ id: string; name: string; description: string | null; can_checkout_quantifiable: boolean }[]> {
  const result = await query(`SELECT id, name, description, can_checkout_quantifiable FROM roles ORDER BY name`);
  return result.rows;
}
