import { NextFunction, Request, Response } from 'express';

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.auth.permissions.includes(permission)) {
      res.status(403).json({ error: 'Forbidden', missing: permission });
      return;
    }

    next();
  };
}
