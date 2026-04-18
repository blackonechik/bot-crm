import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';
import { hashPassword } from '../utils/hash';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('users.read'), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
        role: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(users);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('users.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(2),
      password: z.string().min(8),
      roleId: z.string()
    });

    const data = schema.parse(req.body);
    const passwordHash = await hashPassword(data.password);
    const created = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash,
        roleId: data.roleId
      }
    });

    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', requirePermission('users.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2).optional(),
      isActive: z.boolean().optional(),
      roleId: z.string().optional()
    });

    const data = schema.parse(req.body);
    const updated = await prisma.user.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
