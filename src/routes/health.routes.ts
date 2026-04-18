import { Router } from 'express';
import { prisma } from '../db/prisma';

const router = Router();

router.get('/', async (_req, res) => {
  const dbOk = await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, db: !!dbOk, ts: new Date().toISOString() });
});

export default router;
