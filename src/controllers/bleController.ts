import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listBleTags,
  getBleTagById,
  createBleTag,
  updateBleTag,
  assignTagToItem,
  unassignTag,
  softDeleteBleTag,
  listPresenceStates,
  getLocationHistory,
  getPresenceDetail,
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
    // Accept frontend field names: tag_id -> tag_code, name -> name (stored separately)
    const tag_code = req.body.tag_id ?? req.body.tag_code;
    const { name, item_id } = req.body;
    if (!tag_code) throw new ValidationError('tag_id or tag_code is required');

    const tag = await createBleTag({
      tag_code,
      name: name || null,
      item_id: item_id || null,
      assigned_by: item_id ? req.user!.id : null,
    });
    res.status(201).json({ tag });
  } catch (err) {
    next(err);
  }
}

export async function patchBleTag(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Accept frontend field names: tag_id -> tag_code, name -> name
    const tag_code = req.body.tag_id ?? req.body.tag_code;
    const { name } = req.body;
    const updates: { tag_code?: string; name?: string } = {};
    if (tag_code !== undefined) updates.tag_code = tag_code;
    if (name !== undefined) updates.name = name;

    const tag = await updateBleTag(req.params.id as string, updates);
    res.json({ tag });
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
    // Frontend expects { presence: ItemPresence[] }, not { states }
    const presence = states.map((s: any) => ({
      item_id: s.item_id,
      item_name: s.item_name,
      room_id: s.current_room_id,
      room_name: s.room_name,
      status: s.presence_status,
      last_seen: s.last_seen_at,
      missing_since: s.missing_since,
      device_id: s.last_device_id,
      device_name: s.device_name,
    }));
    res.json({ presence });
  } catch (err) {
    next(err);
  }
}

export async function getPresenceDetailController(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const detail = await getPresenceDetail(req.params.itemId as string);
    res.json(detail);
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
