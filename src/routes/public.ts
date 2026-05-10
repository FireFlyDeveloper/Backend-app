import { Router, Request, Response, NextFunction } from 'express';
import {
  listItems,
  listLotsByItem,
  createCheckout,
  CheckoutLine,
} from '../services/inventoryService';
import { query } from '../utils/db';
import { ValidationError } from '../utils/errors';
import { notifyCheckoutCreated, notifyPublicBorrowerSubmitted } from '../services/emailService';

const router = Router();

// ── System user for public borrows ──────────────────────────────────

const PUBLIC_BORROWER_EMAIL = 'public-borrower@system';
const PUBLIC_BORROWER_NAME = 'Public Borrower';

async function getPublicBorrowerId(): Promise<string> {
  // Use INSERT ... ON CONFLICT to handle concurrent requests safely
  const result = await query(
    `INSERT INTO users (email, display_name, password_hash, is_active)
     VALUES ($1, $2, '', true)
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [PUBLIC_BORROWER_EMAIL, PUBLIC_BORROWER_NAME]
  );
  return result.rows[0].id;
}

// ── Public endpoints (no auth required) ─────────────────────────────

/**
 * GET /public/items
 * List quantifiable active items available for borrowing.
 */
router.get('/public/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search } = req.query;
    const items = await listItems({
      type: 'quantifiable',
      status: 'active',
      search: search as string | undefined,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public/items/:id/lots
 * List lots for a specific item.
 */
router.get('/public/items/:id/lots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lots = await listLotsByItem(req.params.id as string);
    res.json({ lots });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /public/borrow
 * Public borrow request from a student (no login required).
 * Body: { srcode, email, name, course, lines: [{ lot_id, quantity }] }
 *
 * Borrower info is stored in the notes field as JSON.
 * Transaction is created with status 'pending_approval'.
 */
router.post('/public/borrow', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { srcode, email, name, course, lines } = req.body;

    if (!srcode || !email || !name || !course) {
      throw new ValidationError('srcode, email, name, and course are required');
    }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      throw new ValidationError('lines array is required');
    }

    const checkoutLines: CheckoutLine[] = lines.map((l: any) => ({
      lot_id: l.lot_id,
      quantity: Number(l.quantity),
    }));

    // Store borrower info in notes as JSON so it's visible to staff reviewers
    const borrowerInfo = JSON.stringify({ srcode, email, name, course });

    const publicBorrowerId = await getPublicBorrowerId();

    // isAdminOrStaff = false → status becomes 'pending_approval'
    const result = await createCheckout(
      publicBorrowerId,
      checkoutLines,
      borrowerInfo,
      false
    );

    // Send confirmation email to the borrower
    notifyPublicBorrowerSubmitted(name, email, result.transaction.id)
      .catch((err: any) => console.error('[EMAIL] Failed to notify borrower:', err));

    // Notify admin/staff about the new request
    notifyCheckoutCreated(name, email, result.transaction.id, checkoutLines.length)
      .catch((err: any) => console.error('[EMAIL] Failed to notify admins:', err));

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
