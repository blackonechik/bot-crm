import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/categories', requirePermission('faq.read'), async (_req, res, next) => {
  try {
    const categories = await prisma.faqCategory.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'asc' }
    });

    res.json(categories);
  } catch (e) {
    next(e);
  }
});

router.post('/categories', requirePermission('faq.write'), async (req, res, next) => {
  try {
    const schema = z.object({ title: z.string().min(2) });
    const { title } = schema.parse(req.body);
    const created = await prisma.faqCategory.create({ data: { title } });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.get('/items', requirePermission('faq.read'), async (_req, res, next) => {
  try {
    const items = await prisma.faqItem.findMany({
      include: { category: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

router.post('/items', requirePermission('faq.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      categoryId: z.string().optional(),
      question: z.string().min(3),
      aliases: z.array(z.string()).default([]),
      answer: z.string().min(3),
      keywords: z.array(z.string()).default([]),
      isActive: z.boolean().default(true)
    });

    const data = schema.parse(req.body);
    const created = await prisma.faqItem.create({
      data: {
        ...data,
        aliases: data.aliases.map((v) => v.toLowerCase()),
        keywords: data.keywords.map((v) => v.toLowerCase())
      }
    });

    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.patch('/items/:id', requirePermission('faq.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      question: z.string().min(3).optional(),
      aliases: z.array(z.string()).optional(),
      answer: z.string().min(3).optional(),
      keywords: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
      categoryId: z.string().nullable().optional()
    });

    const data = schema.parse(req.body);
    const updated = await prisma.faqItem.update({
      where: { id: req.params.id },
      data: {
        ...data,
        aliases: data.aliases?.map((v) => v.toLowerCase()),
        keywords: data.keywords?.map((v) => v.toLowerCase())
      }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
