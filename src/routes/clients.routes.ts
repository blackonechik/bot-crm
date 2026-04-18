import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('clients.read'), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();

    const clients = await prisma.client.findMany({
      where: q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } }
            ]
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    res.json(clients);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('clients.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      fullName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      username: z.string().optional(),
      city: z.string().optional(),
      company: z.string().optional(),
      source: z.string().optional()
    });

    const data = schema.parse(req.body);
    const created = await prisma.client.create({ data });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', requirePermission('clients.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      fullName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      username: z.string().optional(),
      city: z.string().optional(),
      company: z.string().optional(),
      consentAccepted: z.boolean().optional(),
      tags: z.array(z.string()).optional()
    });

    const data = schema.parse(req.body);
    const updated = await prisma.client.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
