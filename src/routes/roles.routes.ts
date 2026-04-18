import { Router } from 'express';
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
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        permissions: r.permissions.map((p) => p.permission.code)
      }))
    );
  } catch (e) {
    next(e);
  }
});

export default router;
