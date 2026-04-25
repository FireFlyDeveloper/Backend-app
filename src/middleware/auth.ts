import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { query } from '../utils/db';
import { SafeUser } from '../types';
import { UnauthorizedError } from '../utils/errors';

export interface AuthRequest extends Request {
  user?: SafeUser;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = header.slice(7);
    const payload = verifyToken(token);

    const userResult = await query(
      `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
        ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as roles,
        BOOL_OR(r.can_checkout_quantifiable) as can_checkout_quantifiable
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL
       GROUP BY u.id`,
      [payload.id]
    );

    if (userResult.rows.length === 0) {
      throw new UnauthorizedError('User not found');
    }

    const row = userResult.rows[0];
    if (!row.is_active) {
      throw new UnauthorizedError('User is inactive');
    }

    req.user = {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      is_active: row.is_active,
      created_at: row.created_at,
      roles: row.roles || [],
      can_checkout_quantifiable: row.can_checkout_quantifiable || false,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireRoles(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    // Admin bypass
    if (req.user.roles.includes('admin')) {
      return next();
    }
    const hasRole = req.user.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return next(new UnauthorizedError('Insufficient role privileges'));
    }
    next();
  };
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new UnauthorizedError());
  }
  if (!req.user.roles.includes('admin')) {
    return next(new UnauthorizedError('Admin access required'));
  }
  next();
}
