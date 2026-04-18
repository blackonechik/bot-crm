import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('scenarios.read'), async (_req, res, next) => {
  try {
    const scenarios = await prisma.botScenario.findMany({
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(scenarios);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('scenarios.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(2),
      title: z.string().min(2),
      description: z.string().optional(),
      isActive: z.boolean().default(true),
      triggerPhrases: z.array(z.string()).default([]),
      validationRules: z.unknown().optional(),
      transferRules: z.unknown().optional(),
      fallbackText: z.string().nullable().optional()
    });

    const data = schema.parse(req.body);
    const created = await prisma.botScenario.create({
      data: {
        code: data.code,
        title: data.title,
        description: data.description,
        isActive: data.isActive,
        triggerPhrases: data.triggerPhrases,
        validationRules: data.validationRules as object | undefined,
        transferRules: data.transferRules as object | undefined,
        fallbackText: data.fallbackText ?? null
      }
    });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/steps', requirePermission('scenarios.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      type: z.string().min(1),
      title: z.string().min(1),
      payload: z.unknown().optional(),
      order: z.number().int().nonnegative()
    });
    const data = schema.parse(req.body);

    const step = await prisma.scenarioStep.create({
      data: {
        scenarioId: req.params.id,
        type: data.type,
        title: data.title,
        payload: data.payload as object | undefined,
        order: data.order
      }
    });

    res.status(201).json(step);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', requirePermission('scenarios.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(2).optional(),
      title: z.string().min(2).optional(),
      description: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
      triggerPhrases: z.array(z.string()).optional(),
      validationRules: z.unknown().optional(),
      transferRules: z.unknown().optional(),
      fallbackText: z.string().nullable().optional()
    });

    const data = schema.parse(req.body);
    const updated = await prisma.botScenario.update({
      where: { id: req.params.id },
      data: {
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.triggerPhrases !== undefined ? { triggerPhrases: data.triggerPhrases } : {}),
        ...(data.validationRules !== undefined ? { validationRules: data.validationRules as object } : {}),
        ...(data.transferRules !== undefined ? { transferRules: data.transferRules as object } : {}),
        ...(data.fallbackText !== undefined ? { fallbackText: data.fallbackText } : {})
      }
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
