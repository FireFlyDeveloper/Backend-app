import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  softDeleteUser,
  assignRole,
  removeRole,
  listRoles,
} from '../services/userService';
import { ValidationError } from '../utils/errors';

export async function getUsers(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const users = await listUsers();
    res.json({ users });
  } catch (err) {
    next(err);
  }
}

export async function getUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await getUserById(req.params.id as string);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function postUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { email, display_name, password, is_active } = req.body;
    if (!email || !display_name || !password) {
      throw new ValidationError('email, display_name, and password are required');
    }
    const user = await createUser({ email, display_name, password, is_active });
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function patchUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await updateUser(req.params.id as string, req.body);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await softDeleteUser(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function postUserRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { role_id } = req.body;
    const actingUser = req.user;
    if (!actingUser) throw new ValidationError('Not authenticated');
    if (!role_id) throw new ValidationError('role_id is required');
    await assignRole(req.params.id as string, role_id as string, actingUser.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function deleteUserRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await removeRole(req.params.id as string, req.params.rid as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getRoles(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const roles = await listRoles();
    res.json({ roles });
  } catch (err) {
    next(err);
  }
}
