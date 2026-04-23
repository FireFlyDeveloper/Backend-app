import jwt from 'jsonwebtoken';
import { config } from './config';
import { SafeUser } from '../types';

export function signToken(user: SafeUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, roles: user.roles },
    config.jwtSecret,
    { expiresIn: config.jwtExpirySeconds }
  );
}

export function signRefreshToken(user: SafeUser): string {
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
