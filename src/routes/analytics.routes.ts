import { Channel, ChatStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth, requirePermission('analytics.read'));

router.get('/overview', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();

    const whereByDate = { createdAt: { gte: from, lte: to } };

    const [
      totalChats,
      telegramChats,
      maxChats,
      leads,
      completedChats,
      waitingManager,
      faqUsage,
      urgentChats
    ] = await Promise.all([
      prisma.chat.count({ where: whereByDate }),
      prisma.chat.count({ where: { ...whereByDate, channel: Channel.TELEGRAM } }),
      prisma.chat.count({ where: { ...whereByDate, channel: Channel.MAX } }),
      prisma.lead.count({ where: whereByDate }),
      prisma.chat.count({ where: { ...whereByDate, status: ChatStatus.COMPLETED } }),
      prisma.chat.count({ where: { ...whereByDate, status: ChatStatus.WAITING_MANAGER } }),
      prisma.faqItem.aggregate({ _sum: { usageCount: true } }),
      prisma.chat.count({ where: { ...whereByDate, isUrgent: true } })
    ]);

    const conversionToLead = totalChats > 0 ? Number(((leads / totalChats) * 100).toFixed(2)) : 0;

    res.json({
      period: { from, to },
      chats: {
        total: totalChats,
        byChannel: { telegram: telegramChats, max: maxChats },
        completed: completedChats,
        waitingManager,
        urgent: urgentChats
      },
      leads: {
        total: leads,
        conversionToLeadPercent: conversionToLead
      },
      faq: {
        usageCount: faqUsage._sum.usageCount ?? 0
      }
    });
  } catch (e) {
    next(e);
  }
});

export default router;
