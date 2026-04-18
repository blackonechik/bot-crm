import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('notifications.read'), async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: req.query.userId ? { userId: String(req.query.userId) } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    res.json(notifications);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/read', requirePermission('notifications.write'), async (_req, res, next) => {
  try {
    const updated = await prisma.notification.update({
      where: { id: _req.params.id },
      data: { isRead: true }
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('notifications.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      userId: z.string().optional(),
      title: z.string().min(1),
      body: z.string().min(1),
      type: z.string().min(1),
      payload: z.unknown().optional()
    });
    const data = schema.parse(req.body);
    const notification = await prisma.notification.create({
      data: {
        ...data,
        payload: data.payload as object | undefined
      }
    });
    res.status(201).json(notification);
  } catch (e) {
    next(e);
  }
});

export default router;
