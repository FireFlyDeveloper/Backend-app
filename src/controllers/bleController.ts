import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listBleTags,
  getBleTagById,
  createBleTag,
  assignTagToItem,
  unassignTag,
  softDeleteBleTag,
  listPresenceStates,
  getLocationHistory,
} from '../services/bleService';
import { ValidationError } from '../utils/errors';

// --- Tags ---

export async function getBleTags(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tags = await listBleTags();
    res.json({ tags });
  } catch (err) {
    next(err);
  }
}

export async function getBleTag(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tag = await getBleTagById(req.params.id as string);
    res.json({ tag });
  } catch (err) {
    next(err);
  }
}

export async function postBleTag(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { tag_code, item_id } = req.body;
    if (!tag_code) throw new ValidationError('tag_code is required');

    const tag = await createBleTag({
      tag_code,
      item_id: item_id || null,
      assigned_by: item_id ? req.user!.id : null,
    });
    res.status(201).json({ tag });
  } catch (err) {
    next(err);
  }
}

export async function putAssignTag(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { item_id } = req.body;
    if (!item_id) throw new ValidationError('item_id is required');

    const tag = await assignTagToItem(req.params.id as string, item_id, req.user!.id);
    res.json({ tag });
  } catch (err) {
    next(err);
  }
}

export async function putUnassignTag(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tag = await unassignTag(req.params.id as string);
    res.json({ tag });
  } catch (err) {
    next(err);
  }
}

export async function deleteBleTag(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await softDeleteBleTag(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// --- Presence / History ---

export async function getPresence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const states = await listPresenceStates();
    res.json({ states });
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const history = await getLocationHistory(req.params.itemId as string, limit);
    res.json({ history });
  } catch (err) {
    next(err);
  }
}
