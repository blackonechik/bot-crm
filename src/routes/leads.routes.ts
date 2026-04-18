import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';
import { LeadStatus } from '../types/domain';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('leads.read'), async (req, res, next) => {
  try {
    const status = req.query.status ? (String(req.query.status) as LeadStatus) : undefined;

    const leads = await prisma.lead.findMany({
      where: {
        status,
        channel: req.query.channel ? (String(req.query.channel) as 'TELEGRAM' | 'MAX') : undefined
      },
      include: {
        client: true,
        assignedUser: { select: { id: true, name: true } },
        chat: { select: { id: true, status: true } }
      },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });

    res.json(leads);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('leads.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      clientId: z.string(),
      chatId: z.string(),
      channel: z.enum(['TELEGRAM', 'MAX']),
      source: z.string().optional(),
      fullName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      username: z.string().optional(),
      comment: z.string().optional(),
      interest: z.string().optional(),
      assignedUserId: z.string().optional()
    });

    const data = schema.parse(req.body);
    const created = await prisma.lead.create({
      data: {
        ...data,
        status: LeadStatus.NEW
      }
    });

    await prisma.leadStatusHistory.create({
      data: {
        leadId: created.id,
        toStatus: LeadStatus.NEW,
        changedById: req.auth!.userId,
        reason: 'Lead created manually'
      }
    });

    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/status', requirePermission('leads.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.nativeEnum(LeadStatus),
      reason: z.string().optional()
    });

    const { status, reason } = schema.parse(req.body);

    const current = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const updated = await prisma.lead.update({ where: { id: req.params.id }, data: { status } });

    await prisma.leadStatusHistory.create({
      data: {
        leadId: updated.id,
        fromStatus: current.status,
        toStatus: status,
        changedById: req.auth!.userId,
        reason
      }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/comments', requirePermission('leads.write'), async (req, res, next) => {
  try {
    const schema = z.object({ content: z.string().min(1) });
    const { content } = schema.parse(req.body);

    const comment = await prisma.leadComment.create({
      data: {
        leadId: req.params.id,
        authorId: req.auth!.userId,
        content
      }
    });

    res.status(201).json(comment);
  } catch (e) {
    next(e);
  }
});

router.get('/export/csv', requirePermission('leads.read'), async (_req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({
      include: { client: true, assignedUser: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });

    const escape = (value: unknown) => {
      const text = value == null ? '' : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };

    const rows = [
      ['id', 'createdAt', 'source', 'channel', 'name', 'phone', 'email', 'username', 'company', 'comment', 'interest', 'status', 'assignedUser'].join(','),
      ...leads.map((lead) =>
        [
          lead.id,
          lead.createdAt.toISOString(),
          lead.source ?? '',
          lead.channel,
          lead.fullName ?? '',
          lead.phone ?? '',
          lead.email ?? '',
          lead.username ?? '',
          lead.company ?? '',
          lead.comment ?? '',
          lead.interest ?? '',
          lead.status,
          lead.assignedUser?.name ?? ''
        ].map(escape).join(',')
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(rows);
  } catch (e) {
    next(e);
  }
});

export default router;
