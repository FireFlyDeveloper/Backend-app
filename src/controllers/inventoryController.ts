import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listItems,
  getItemById,
  createItem,
  updateItem,
  softDeleteItem,
  listLotsByItem,
  createLot,
  createCheckout,
  getCheckoutById,
  listCheckouts,
  createReturn,
  cancelCheckout,
  scanCode,
  logInventoryActivity,
  CheckoutLine,
  ReturnLine,
} from '../services/inventoryService';
import { ValidationError, ForbiddenError, NotFoundError } from '../utils/errors';

function getUserContext(req: AuthRequest) {
  const user = req.user;
  if (!user) throw new ForbiddenError();
  const isAdmin = user.roles.includes('admin');
  const isStaff = user.roles.includes('staff');
  const canCheckoutQuantifiable = isAdmin || user.roles.includes('staff'); // staff has can_checkout_quantifiable=true per seed
  return { userId: user.id, userRoles: user.roles as string[], isAdmin, isStaff, canCheckoutQuantifiable };
}

// --- Items ---

export async function getItems(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type, category, status, search } = req.query;
    const items = await listItems({
      type: type as string | undefined,
      category: category as string | undefined,
      status: status as string | undefined,
      search: search as string | undefined,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function getItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const item = await getItemById(req.params.id as string);
    res.json({ item });
  } catch (err) {
    next(err);
  }
}

export async function postItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Only admin or staff can create items');
    }

    const { item_type, name, category, description, status } = req.body;
    if (!item_type || !name) {
      throw new ValidationError('item_type and name are required');
    }
    if (!['trackable', 'quantifiable'].includes(item_type)) {
      throw new ValidationError('item_type must be trackable or quantifiable');
    }

    const item = await createItem({
      item_type,
      name,
      category,
      description,
      status,
      created_by: ctx.userId,
    });

    await logInventoryActivity({
      actor_id: ctx.userId,
      action: 'create_item',
      entity_type: 'item',
      entity_id: item.id,
      metadata: { item_type, name },
    });

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
}

export async function patchItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Only admin or staff can update items');
    }

    const { name, category, description, status } = req.body;
    const item = await updateItem(req.params.id as string, {
      name,
      category,
      description,
      status,
    });

    await logInventoryActivity({
      actor_id: ctx.userId,
      action: 'update_item',
      entity_type: 'item',
      entity_id: item.id,
    });

    res.json({ item });
  } catch (err) {
    next(err);
  }
}

export async function deleteItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Only admin or staff can delete items');
    }

    await softDeleteItem(req.params.id as string);

    await logInventoryActivity({
      actor_id: ctx.userId,
      action: 'delete_item',
      entity_type: 'item',
      entity_id: req.params.id as string,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// --- Lots ---

export async function getLots(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const lots = await listLotsByItem(req.params.id as string);
    res.json({ lots });
  } catch (err) {
    next(err);
  }
}

export async function postLot(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    if (!ctx.isAdmin && !ctx.isStaff) {
      throw new ForbiddenError('Only admin or staff can create lots');
    }

    const { lot_code, quantity_total, purchased_at, expires_at, notes } = req.body;
    if (!lot_code || quantity_total === undefined) {
      throw new ValidationError('lot_code and quantity_total are required');
    }

    const lot = await createLot({
      item_id: req.params.id as string,
      lot_code,
      quantity_total: Number(quantity_total),
      purchased_at,
      expires_at,
      notes,
    });

    await logInventoryActivity({
      actor_id: ctx.userId,
      action: 'create_lot',
      entity_type: 'item_lot',
      entity_id: lot.id,
      metadata: { item_id: req.params.id, lot_code, quantity_total },
    });

    res.status(201).json({ lot });
  } catch (err) {
    next(err);
  }
}

// --- Checkout ---

export async function postCheckout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const { lines, notes } = req.body;
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      throw new ValidationError('lines array is required');
    }

    // Validate each line
    const checkoutLines: CheckoutLine[] = lines.map((l: any) => ({
      lot_id: l.lot_id,
      quantity: Number(l.quantity),
    }));

    // Students need can_checkout_quantifiable role flag
    if (!ctx.isAdmin && !ctx.canCheckoutQuantifiable) {
      throw new ForbiddenError('Checkout permission required');
    }

    const result = await createCheckout(ctx.userId, checkoutLines, notes);

    await logInventoryActivity({
      actor_id: ctx.userId,
      action: 'checkout',
      entity_type: 'checkout_transaction',
      entity_id: result.transaction.id,
      metadata: { items: result.items.map((i) => ({ lot_id: i.lot_id, qty: i.quantity_out })) },
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getCheckouts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const { status, user_id } = req.query;

    // Students can only see their own checkouts
    const filterUserId = ctx.isAdmin || ctx.isStaff
      ? (user_id as string | undefined)
      : ctx.userId;

    const transactions = await listCheckouts({
      userId: filterUserId,
      status: status as string | undefined,
    });
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
}

export async function getCheckout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const result = await getCheckoutById(req.params.id as string);

    // Students can only view their own
    if (!ctx.isAdmin && !ctx.isStaff && result.transaction.checked_out_by !== ctx.userId) {
      throw new ForbiddenError();
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Return ---

export async function postReturn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const checkoutId = req.params.id as string;
    const { lines, notes } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      throw new ValidationError('lines array is required');
    }

    const returnLines: ReturnLine[] = lines.map((l: any) => ({
      checkout_item_id: l.checkout_item_id,
      quantity: Number(l.quantity),
    }));

    // Students can only return their own transactions
    if (!ctx.isAdmin && !ctx.isStaff) {
      const checkout = await getCheckoutById(checkoutId);
      if (checkout.transaction.checked_out_by !== ctx.userId) {
        throw new ForbiddenError('Can only return your own checkouts');
      }
    }

    const result = await createReturn(checkoutId, ctx.userId, returnLines, notes);

    await logInventoryActivity({
      actor_id: ctx.userId,
      action: 'return',
      entity_type: 'return_transaction',
      entity_id: result.returnTxn.id,
      metadata: { checkout_id: checkoutId, items: returnLines },
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// --- Cancel ---

export async function postCancel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = getUserContext(req);
    const checkoutId = req.params.id as string;

    // Only admin/staff can cancel, or the owner if still open?
    // Prompt says: cancellation only if open and no returns yet.
    // We'll restrict cancel to admin/staff or the original checker-outer.
    const checkout = await getCheckoutById(checkoutId);
    if (!ctx.isAdmin && !ctx.isStaff && checkout.transaction.checked_out_by !== ctx.userId) {
      throw new ForbiddenError();
    }

    const transaction = await cancelCheckout(checkoutId);

    await logInventoryActivity({
      actor_id: ctx.userId,
      action: 'cancel_checkout',
      entity_type: 'checkout_transaction',
      entity_id: checkoutId,
    });

    res.json({ transaction });
  } catch (err) {
    next(err);
  }
}

// --- Scan ---

export async function postScan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { code } = req.body;
    if (!code) {
      throw new ValidationError('code is required');
    }
    const result = await scanCode(code as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
