import { Request, Response, NextFunction } from 'express';
import { getUserByEmail, getUserById } from '../services/userService';
import { SafeUser } from '../types';
import { verifyPassword } from '../utils/password';
import { signToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { UnauthorizedError } from '../utils/errors';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new UnauthorizedError('Email and password required');
    }

    const user = await getUserByEmail(email);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Fetch user with roles
    const userWithRoles = await getUserById(user.id);
    const userForResponse: SafeUser = {
      id: userWithRoles.id,
      email: userWithRoles.email,
      display_name: userWithRoles.display_name,
      is_active: userWithRoles.is_active,
      created_at: userWithRoles.created_at,
      roles: userWithRoles.roles.map((r) => r.name),
      can_checkout_quantifiable: userWithRoles.can_checkout_quantifiable,
    };

    const token = signToken(userForResponse);
    const refreshToken = signRefreshToken(userForResponse);
    res.json({ token, refreshToken, user: userForResponse });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token required');
    }

    const payload = verifyRefreshToken(refreshToken);
    const userWithRoles = await getUserById(payload.id);
    const userForResponse: SafeUser = {
      id: userWithRoles.id,
      email: userWithRoles.email,
      display_name: userWithRoles.display_name,
      is_active: userWithRoles.is_active,
      created_at: userWithRoles.created_at,
      roles: userWithRoles.roles.map((r) => r.name),
      can_checkout_quantifiable: userWithRoles.can_checkout_quantifiable,
    };

    const newToken = signToken(userForResponse);
    const newRefreshToken = signRefreshToken(userForResponse);
    res.json({ token: newToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    // For JWT stateless auth, instruct client to discard tokens.
    // Server-side blocklist can be added here if needed.
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const { user } = req as any;
    if (!user) throw new UnauthorizedError();
    res.json({ user });
  } catch (err) {
    next(err);
  }
}
