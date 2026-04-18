import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('roles.read'), async (_req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });

    res.json(
      roles.map((r: { id: string; name: string; description: string | null; permissions: Array<{ permission: { code: string } }> }) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        permissions: r.permissions.map((p: { permission: { code: string } }) => p.permission.code)
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.get('/permissions', requirePermission('roles.read'), async (_req, res, next) => {
  try {
    const permissions = await prisma.permission.findMany({ orderBy: { code: 'asc' } });
    res.json(permissions);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('roles.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      description: z.string().optional()
    });
    const data = schema.parse(req.body);
    const role = await prisma.role.create({ data });
    res.status(201).json(role);
  } catch (e) {
    next(e);
  }
});

export default router;

router.patch('/:id', requirePermission('roles.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2).optional(),
      description: z.string().nullable().optional()
    });
    const data = schema.parse(req.body);
    const role = await prisma.role.update({ where: { id: req.params.id }, data });
    res.json(role);
  } catch (e) {
    next(e);
  }
});

router.put('/:id/permissions', requirePermission('roles.write'), async (req, res, next) => {
  try {
    const schema = z.object({ permissions: z.array(z.string()) });
    const { permissions } = schema.parse(req.body);

    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    const rows = await prisma.permission.findMany({ where: { code: { in: permissions } } });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: rows.map((permission) => ({ roleId: role.id, permissionId: permission.id }))
    });

    res.json({ ok: true, permissions });
  } catch (e) {
    next(e);
  }
});
