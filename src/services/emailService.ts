import nodemailer from 'nodemailer';
import { query } from '../utils/db';

// --- Configuration ---

function getTransporter() {
  const host = process.env.MAIL_HOST || 'localhost';
  const port = parseInt(process.env.MAIL_PORT || '25', 10);
  const user = process.env.MAIL_USER || '';
  const pass = process.env.MAIL_PASS || '';

  // If no SMTP credentials, log to console instead
  if (!user && !pass && (host === 'localhost' || host === '127.0.0.1')) {
    return null; // signals console-only mode
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  } as nodemailer.TransportOptions);
}

const FROM_ADDRESS = process.env.MAIL_FROM || 'noreply@inventory.local';

// --- Log/email dispatcher ---

async function sendOrLog(to: string, subject: string, text: string): Promise<void> {
  const transporter = getTransporter();

  if (!transporter) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject} | Body: ${text.replace(/\n/g, ' | ')}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      text,
    });
    console.log(`[EMAIL] Sent to ${to}: "${subject}"`);
  } catch (err) {
    console.error(`[EMAIL] Failed to send to ${to}: "${subject}"`, err);
  }
}

// --- Helpers ---

/** Get all active admin/staff email addresses */
async function getAdminStaffEmails(): Promise<string[]> {
  const result = await query(
    `SELECT DISTINCT u.email
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name IN ('admin', 'staff')
       AND u.deleted_at IS NULL
       AND u.is_active = true`
  );
  return result.rows.map((r: any) => r.email).filter(Boolean);
}

/** Get email for a specific user */
async function getUserEmail(userId: string): Promise<string | null> {
  const result = await query(
    `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL AND is_active = true`,
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0].email : null;
}

/** Get display_name for a specific user */
async function getUserDisplayName(userId: string): Promise<string | null> {
  const result = await query(
    `SELECT display_name FROM users WHERE id = $1 AND deleted_at IS NULL AND is_active = true`,
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0].display_name : null;
}

// --- Notification functions ---

/**
 * Notify admin/staff that a new checkout request has been created.
 */
export async function notifyCheckoutCreated(
  requesterName: string,
  requesterEmail: string,
  checkoutId: string,
  itemsCount: number
): Promise<void> {
  const adminEmails = await getAdminStaffEmails();
  if (adminEmails.length === 0) {
    console.log(`[EMAIL] No admin/staff emails found to notify about checkout ${checkoutId}`);
    return;
  }

  const subject = `New checkout request from ${requesterName}`;
  const text = [
    `A new checkout request has been submitted.`,
    ``,
    `Requester: ${requesterName} (${requesterEmail})`,
    `Checkout ID: ${checkoutId}`,
    `Items: ${itemsCount}`,
    ``,
    `Please review and approve or reject this request.`,
  ].join('\n');

  // Send to all admin/staff (multiple recipients via BCC to each)
  for (const email of adminEmails) {
    await sendOrLog(email, subject, text);
  }
}

/**
 * Notify the requester that their checkout has been approved.
 */
export async function notifyCheckoutApproved(
  requesterId: string,
  checkoutId: string
): Promise<void> {
  const email = await getUserEmail(requesterId);
  if (!email) {
    console.log(`[EMAIL] No email found for user ${requesterId} (checkout approved)`);
    return;
  }

  const displayName = await getUserDisplayName(requesterId) || 'User';

  const subject = 'Your checkout request has been approved';
  const text = [
    `Hello ${displayName},`,
    ``,
    `Your checkout request (ID: ${checkoutId}) has been approved.`,
    `You may now proceed to pick up the items.`,
    ``,
    `Thank you.`,
  ].join('\n');

  await sendOrLog(email, subject, text);
}

/**
 * Notify the requester that their checkout has been rejected.
 */
export async function notifyCheckoutRejected(
  requesterId: string,
  checkoutId: string
): Promise<void> {
  const email = await getUserEmail(requesterId);
  if (!email) {
    console.log(`[EMAIL] No email found for user ${requesterId} (checkout rejected)`);
    return;
  }

  const displayName = await getUserDisplayName(requesterId) || 'User';

  const subject = 'Your checkout request has been rejected';
  const text = [
    `Hello ${displayName},`,
    ``,
    `Your checkout request (ID: ${checkoutId}) has been rejected.`,
    `If you have questions, please contact the inventory staff.`,
    ``,
    `Thank you.`,
  ].join('\n');

  await sendOrLog(email, subject, text);
}

/**
 * Notify a public borrower that their request has been submitted.
 */
export async function notifyPublicBorrowerSubmitted(
  studentName: string,
  studentEmail: string,
  checkoutId: string
): Promise<void> {
  const subject = 'Borrow request submitted — Admin Records';
  const text = [
    `Hello ${studentName},`,
    ``,
    `Your borrow request (ID: ${checkoutId}) has been submitted successfully.`,
    `Please wait for staff to review and approve your request.`,
    `You will receive another email once it's been processed.`,
    ``,
    `Thank you.`,
  ].join('\n');

  await sendOrLog(studentEmail, subject, text);
}

/**
 * Notify a public borrower that their request has been approved.
 * Uses the student's actual email from the checkout notes.
 */
export async function notifyPublicBorrowerApproved(
  studentName: string,
  studentEmail: string,
  checkoutId: string
): Promise<void> {
  const subject = 'Borrow request approved — Admin Records';
  const text = [
    `Hello ${studentName},`,
    ``,
    `Your borrow request (ID: ${checkoutId}) has been approved!`,
    `You may now proceed to pick up the items.`,
    ``,
    `If you have any questions, please contact the inventory staff.`,
    ``,
    `Thank you.`,
  ].join('\n');

  await sendOrLog(studentEmail, subject, text);
}
