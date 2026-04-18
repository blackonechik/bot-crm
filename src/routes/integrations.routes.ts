import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('integrations.read'), async (_req, res, next) => {
  try {
    const rows = await prisma.integrationSetting.findMany({ orderBy: { key: 'asc' } });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/:key', requirePermission('integrations.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      isEnabled: z.boolean(),
      payload: z.unknown().optional()
    });

    const data = schema.parse(req.body);
    const payload = data.payload as Prisma.InputJsonValue | undefined;
    const updated = await prisma.integrationSetting.upsert({
      where: { key: req.params.key },
      update: {
        isEnabled: data.isEnabled,
        ...(data.payload !== undefined ? { payload } : {})
      },
      create: {
        key: req.params.key,
        isEnabled: data.isEnabled,
        ...(data.payload !== undefined ? { payload } : {})
      }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
