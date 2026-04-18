import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { comparePassword, hashPassword } from '../utils/hash';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { requireAuth } from '../middlewares/auth';
import { writeAuditLog } from '../utils/audit';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  roleName: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

router.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const role = await prisma.role.findUnique({ where: { name: data.roleName ?? 'operator' } });

    if (!role) {
      res.status(400).json({ error: 'Role not found' });
      return;
    }

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash,
        roleId: role.id
      },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });

    await writeAuditLog({ req, userId: user.id, action: 'register', entity: 'user', entityId: user.id });

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name
    });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await comparePassword(data.password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const permissions = user.role.permissions.map((p) => p.permission.code);
    const accessToken = signAccessToken({ sub: user.id, role: user.role.name, permissions });
    const refreshToken = signRefreshToken(user.id);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000)
      }
    });

    await writeAuditLog({ req, userId: user.id, action: 'login', entity: 'auth' });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        permissions
      }
    });
  } catch (e) {
    next(e);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const token = String(req.body?.refreshToken ?? '');
    if (!token) {
      res.status(400).json({ error: 'refreshToken required' });
      return;
    }

    const payload = verifyRefreshToken(token);
    const stored = await prisma.refreshToken.findUnique({ where: { token } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const permissions = user.role.permissions.map((p) => p.permission.code);
    const accessToken = signAccessToken({ sub: user.id, role: user.role.name, permissions });

    res.json({ accessToken });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token = String(req.body?.refreshToken ?? '');
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { token, userId: req.auth!.userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }

    await writeAuditLog({ req, action: 'logout', entity: 'auth' });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      permissions: user.role.permissions.map((p) => p.permission.code)
    });
  } catch (e) {
    next(e);
  }
});

export default router;
