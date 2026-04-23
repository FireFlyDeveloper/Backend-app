import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/errors';

export function validateBody(fields: { key: string; type: 'string' | 'number' | 'boolean'; required?: boolean }[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const f of fields) {
      const val = req.body[f.key];
      if (f.required && (val === undefined || val === null || val === '')) {
        return next(new ValidationError(`Missing required field: ${f.key}`));
      }
      if (val !== undefined && val !== null) {
        if (f.type === 'string' && typeof val !== 'string') {
          return next(new ValidationError(`Field ${f.key} must be a string`));
        }
        if (f.type === 'number' && typeof val !== 'number') {
          return next(new ValidationError(`Field ${f.key} must be a number`));
        }
        if (f.type === 'boolean' && typeof val !== 'boolean') {
          return next(new ValidationError(`Field ${f.key} must be a boolean`));
        }
      }
    }
    next();
  };
}
