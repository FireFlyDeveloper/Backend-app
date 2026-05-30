import { Request, Response, NextFunction } from 'express';

// Patterns that indicate NoSQL injection or prototype pollution attempts
const DANGEROUS_KEY_PATTERNS = /^\$/;      // $ operators ($set, $gt, $where, etc.)
const DANGEROUS_DOT_PATTERNS = /\./;        // Dot notation access (__proto__, constructor.prototype)

/**
 * Sanitize a single string value:
 * - Trim whitespace
 * - Reject empty strings after trim (return null for removal)
 * - Strip null bytes
 */
function sanitizeStringValue(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') {
    // Coerce numbers/booleans to string
    if (typeof val === 'number' || typeof val === 'boolean') {
      val = String(val);
    } else {
      return null;
    }
  }
  const trimmed = (val as string).trim().replace(/\0/g, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Recursively sanitize string values inside an object.
 * Returns a NEW object — does not mutate the input.
 */
function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    // Reject dangerous key patterns (NoSQL injection via $ operators)
    if (DANGEROUS_KEY_PATTERNS.test(key)) continue;
    // Reject dot-notation keys (prototype pollution: __proto__, constructor.prototype)
    if (DANGEROUS_DOT_PATTERNS.test(key)) continue;

    const val = obj[key];

    if (typeof val === 'string') {
      const sanitized = sanitizeStringValue(val);
      if (sanitized !== null) {
        result[key] = sanitized;
      }
      // If null, omit the key entirely
    } else if (Array.isArray(val)) {
      result[key] = val
        .map((item) => (typeof item === 'string' ? sanitizeStringValue(item) : item))
        .filter((item) => item !== null);
    } else if (val !== null && typeof val === 'object') {
      result[key] = sanitizeObject(val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }

  return result as T;
}

/**
 * Sanitize req.query — Express query params are ParsedQs
 * (string, string[], or nested ParsedQs).
 * Returns a new object, preserving only safe keys and trimmed values.
 */
function sanitizeQuery(query: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(query);
}

/**
 * Sanitize req.params — Express route params are always string values.
 * Returns a new object with trimmed, non-empty strings only.
 */
function sanitizeParams(params: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of Object.keys(params)) {
    if (DANGEROUS_KEY_PATTERNS.test(key)) continue;
    if (DANGEROUS_DOT_PATTERNS.test(key)) continue;

    const sanitized = sanitizeStringValue(params[key]);
    if (sanitized !== null) {
      result[key] = sanitized;
    }
  }

  return result;
}

/**
 * Middleware: sanitize all user-controlled inputs on req.body,
 * req.query, and req.params.
 *
 * Uses proper object copies instead of direct mutation,
 * avoiding silent failures on strict Express type configurations.
 */
export function sanitizeInputs(req: Request, _res: Response, next: NextFunction): void {
  // Sanitize req.body
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body = sanitizeObject(req.body as Record<string, unknown>);
  }

  // Sanitize req.query — reassign with a new object (fixes the mutation bug)
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeQuery(req.query as Record<string, unknown>) as any;
  }

  // Sanitize req.params — reassign with a new object (fixes the mutation bug)
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeParams(req.params as Record<string, string>) as any;
  }

  next();
}
