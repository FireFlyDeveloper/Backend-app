import jwt from 'jsonwebtoken';
import { config } from './config';
import { SafeUser, UserWithRoles } from '../types';

function extractRoleNames(user: SafeUser | UserWithRoles): string[] {
  if (!user.roles || user.roles.length === 0) return [];
  if (typeof user.roles[0] === 'string') return user.roles as string[];
  return (user.roles as { name: string }[]).map((r) => r.name);
}

export function signToken(user: SafeUser | UserWithRoles): string {
  return jwt.sign(
    { id: user.id, email: user.email, roles: extractRoleNames(user) },
    config.jwtSecret,
    { expiresIn: config.jwtExpirySeconds }
  );
}

export function signRefreshToken(user: SafeUser | UserWithRoles): string {
  return jwt.sign(
    { id: user.id, email: user.email },
    config.jwtRefreshSecret,
    { expiresIn: config.jwtRefreshExpirySeconds }
  );
}

export function verifyToken(token: string): { id: string; email: string; roles: string[] } {
  return jwt.verify(token, config.jwtSecret) as { id: string; email: string; roles: string[] };
}

export function verifyRefreshToken(token: string): { id: string; email: string } {
  return jwt.verify(token, config.jwtRefreshSecret) as { id: string; email: string };
}
