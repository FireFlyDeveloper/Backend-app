import { query, withTransaction } from '../utils/db';
import { hashPassword } from '../utils/password';
import { SafeUser, UserWithRoles, PaginatedUsers, UserRoleDetail } from '../types';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';

function mapUserRow(row: any): UserWithRoles {
  const roles: UserRoleDetail[] = row.role_ids
    ? row.role_ids.map((id: string, i: number) => ({
        id,
        name: row.role_names[i],
        description: row.role_descriptions?.[i] ?? null,
      }))
    : [];

  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    is_active: row.is_active,
    created_at: row.created_at,
    roles,
    can_checkout_quantifiable: row.can_checkout_quantifiable || false,
  };
}

export async function listUsers(options?: {
  page?: number;
  per_page?: number;
  search?: string;
  role?: string;
  is_active?: boolean;
}): Promise<PaginatedUsers> {
  const page = Math.max(1, options?.page ?? 1);
  const per_page = Math.min(100, Math.max(1, options?.per_page ?? 20));
  const offset = (page - 1) * per_page;

  const conditions: string[] = ['u.deleted_at IS NULL'];
  const values: any[] = [];
  let idx = 1;

  if (options?.search) {
    conditions.push(`(
      u.email ILIKE $${idx}
      OR u.display_name ILIKE $${idx}
    )`);
    values.push(`%${options.search}%`);
    idx++;
  }

  if (options?.role) {
    conditions.push(`EXISTS (
      SELECT 1 FROM user_roles ur2
      JOIN roles r2 ON r2.id = ur2.role_id
      WHERE ur2.user_id = u.id AND r2.name = $${idx}
    )`);
    values.push(options.role);
    idx++;
  }

  if (options?.is_active !== undefined) {
    conditions.push(`u.is_active = $${idx}`);
    values.push(options.is_active);
    idx++;
  }

  const whereClause = conditions.join(' AND ');

  // Count total
  const countResult = await query(
    `SELECT COUNT(DISTINCT u.id) as total FROM users u WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Fetch paginated users with roles
  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
      ARRAY_AGG(r.id) FILTER (WHERE r.id IS NOT NULL) as role_ids,
      ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as role_names,
      ARRAY_AGG(r.description) FILTER (WHERE r.description IS NOT NULL) as role_descriptions,
      BOOL_OR(r.can_checkout_quantifiable) as can_checkout_quantifiable
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE ${whereClause}
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, per_page, offset]
  );

  const users = result.rows.map(mapUserRow);

  return {
    users,
    total,
    page,
    per_page,
    total_pages: Math.ceil(total / per_page),
  };
}

export async function getUserById(id: string): Promise<UserWithRoles> {
  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
      ARRAY_AGG(r.id) FILTER (WHERE r.id IS NOT NULL) as role_ids,
      ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as role_names,
      ARRAY_AGG(r.description) FILTER (WHERE r.description IS NOT NULL) as role_descriptions,
      BOOL_OR(r.can_checkout_quantifiable) as can_checkout_quantifiable
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [id]
  );
  if (result.rows.length === 0) throw new NotFoundError('User not found');
  return mapUserRow(result.rows[0]);
}

export async function getUserByEmail(email: string): Promise<{ id: string; email: string; display_name: string; password_hash: string; is_active: boolean } | null> {
  const result = await query(
    `SELECT id, email, display_name, password_hash, is_active FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email]
  );
  return result.rows[0] || null;
}

export async function createUser(data: {
  email: string;
  display_name: string;
  password: string;
  is_active?: boolean;
  role_ids?: string[];
}): Promise<UserWithRoles> {
  const passwordHash = await hashPassword(data.password);

  const existing = await query(`SELECT id, deleted_at FROM users WHERE email = $1`, [data.email]);
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.deleted_at) {
      const result = await query(
        `UPDATE users
         SET deleted_at = NULL,
             display_name = $1,
             password_hash = $2,
             is_active = $3
         WHERE id = $4
         RETURNING id, email, display_name, is_active, created_at`,
        [data.display_name, passwordHash, data.is_active ?? true, row.id]
      );
      const userId = result.rows[0].id;

      if (data.role_ids && data.role_ids.length > 0) {
        const validRoles = await query(`SELECT id FROM roles WHERE id = ANY($1) AND name != 'student'`, [data.role_ids]);
        const validRoleIds = validRoles.rows.map((r) => r.id);
        for (const roleId of validRoleIds) {
          await query(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [userId, roleId]
          );
        }
      }

      return getUserById(userId);
    }
    throw new ConflictError('Email already in use');
  }

  const result = await query(
    `INSERT INTO users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, display_name, is_active, created_at`,
    [data.email, data.display_name, passwordHash, data.is_active ?? true]
  );

  const userId = result.rows[0].id;

  // Assign roles if provided
  if (data.role_ids && data.role_ids.length > 0) {
    const validRoles = await query(`SELECT id FROM roles WHERE id = ANY($1) AND name != 'student'`, [data.role_ids]);
    const validRoleIds = validRoles.rows.map((r) => r.id);
    for (const roleId of validRoleIds) {
      await query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, roleId]
      );
    }
  }

  return getUserById(userId);
}

export async function updateUser(
  id: string,
  data: { display_name?: string; email?: string; is_active?: boolean; password?: string; role_ids?: string[] }
): Promise<UserWithRoles> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.display_name !== undefined) {
    sets.push(`display_name = $${idx++}`);
    values.push(data.display_name);
  }
  if (data.email !== undefined) {
    const existing = await query(`SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL`, [
      data.email,
      id,
    ]);
    if (existing.rows.length > 0) throw new ConflictError('Email already in use');
    sets.push(`email = $${idx++}`);
    values.push(data.email);
  }
  if (data.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(data.is_active);
  }
  if (data.password) {
    sets.push(`password_hash = $${idx++}`);
    values.push(await hashPassword(data.password));
  }
  if (sets.length === 0 && (!data.role_ids || data.role_ids.length === 0)) {
    throw new Error('No fields to update');
  }

  // Update user fields
  if (sets.length > 0) {
    sets.push(`updated_at = now()`);
    values.push(id);
    const result = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING id`,
      values
    );
    if (result.rows.length === 0) throw new NotFoundError('User not found');
  }

  // Update roles if provided
  if (data.role_ids !== undefined) {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]);
      if (data.role_ids!.length > 0) {
        const validRoles = await client.query(`SELECT id FROM roles WHERE id = ANY($1) AND name != 'student'`, [data.role_ids]);
        const validRoleIds = validRoles.rows.map((r) => r.id);
        for (const roleId of validRoleIds) {
          await client.query(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, roleId]
          );
        }
      }
    });
  }

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

    const roleCheck = await client.query(`SELECT id, name FROM roles WHERE id = $1`, [roleId]);
    if (roleCheck.rows.length === 0) throw new NotFoundError('Role not found');
    if (roleCheck.rows[0].name === 'student') throw new ValidationError('Student role has been removed');

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
  const result = await query(`SELECT id, name, description, can_checkout_quantifiable FROM roles WHERE name != 'student' ORDER BY name`);
  return result.rows;
}
