import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('events.read'), async (_req, res, next) => {
  try {
    const events = await prisma.eventLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    res.json(events);
  } catch (e) {
    next(e);
  }
});

export default router;
