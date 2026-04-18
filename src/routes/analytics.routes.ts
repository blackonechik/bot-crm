import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';
import { Channel, ChatStatus } from '../types/domain';

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
      appointments,
      completedChats,
      waitingManager,
      faqUsage,
      urgentChats,
      chatsWithFirstResponse
    ] = await Promise.all([
      prisma.chat.count({ where: whereByDate }),
      prisma.chat.count({ where: { ...whereByDate, channel: Channel.TELEGRAM } }),
      prisma.chat.count({ where: { ...whereByDate, channel: Channel.MAX } }),
      prisma.lead.count({ where: whereByDate }),
      prisma.appointment.count({ where: { scheduledAt: { gte: from, lte: to } } }),
      prisma.chat.count({ where: { ...whereByDate, status: ChatStatus.COMPLETED } }),
      prisma.chat.count({ where: { ...whereByDate, status: ChatStatus.WAITING_MANAGER } }),
      prisma.faqItem.aggregate({ _sum: { usageCount: true } }),
      prisma.chat.count({ where: { ...whereByDate, isUrgent: true } }),
      prisma.chat.findMany({
        where: { ...whereByDate, firstResponseAt: { not: null } },
        select: { createdAt: true, firstResponseAt: true }
      })
    ]);

    const conversionToLead = totalChats > 0 ? Number(((leads / totalChats) * 100).toFixed(2)) : 0;
    const avgFirstResponseMinutes =
      chatsWithFirstResponse.length > 0
        ? Number(
            (
              chatsWithFirstResponse.reduce((sum, chat) => {
                return sum + (chat.firstResponseAt!.getTime() - chat.createdAt.getTime()) / 60000;
              }, 0) / chatsWithFirstResponse.length
            ).toFixed(2)
          )
        : 0;

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
      appointments: {
        total: appointments
      },
      faq: {
        usageCount: faqUsage._sum.usageCount ?? 0
      },
      sla: {
        averageFirstResponseMinutes: avgFirstResponseMinutes
      }
    });
  } catch (e) {
    next(e);
  }
});

export default router;
