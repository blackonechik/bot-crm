import { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { verifyAccessToken } from '../utils/jwt';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    req.auth = {
      userId: user.id,
      role: { id: user.role.id, name: user.role.name },
      permissions: user.role.permissions.map((p) => p.permission.code)
    };

    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
