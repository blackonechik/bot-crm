import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';
import { sendMaxMessage } from '../services/max-bot.service';
import { sendTelegramMessage } from '../services/telegram-bot.service';
import { Channel, ChatMode, ChatStatus, MessageDirection } from '../types/domain';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('chats.read'), async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const channel = req.query.channel ? String(req.query.channel) : undefined;
    const assignedUserId = req.query.assignedUserId ? String(req.query.assignedUserId) : undefined;

    const chats = await prisma.chat.findMany({
      where: {
        status: status as ChatStatus | undefined,
        channel: channel as 'TELEGRAM' | 'MAX' | undefined,
        assignedUserId
      },
      include: {
        client: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } }
      },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });

    res.json(chats);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requirePermission('chats.read'), async (req, res, next) => {
  try {
    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        assignedUser: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        internalNotes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, name: true } } } },
        lead: true
      }
    });

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    res.json(chat);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/messages', requirePermission('messages.send'), async (req, res, next) => {
  try {
    const schema = z.object({ text: z.string().min(1) });
    const data = schema.parse(req.body);

    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      select: { id: true, channel: true, externalChatId: true }
    });

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    const message = await prisma.message.create({
      data: {
        chatId: req.params.id,
        text: data.text,
        direction: MessageDirection.OUTBOUND as any,
        senderUserId: req.auth!.userId
      }
    });

    if (chat.channel === Channel.TELEGRAM) {
      const sent = await sendTelegramMessage(chat.externalChatId, data.text);
      if (sent?.message_id !== undefined) {
        await prisma.message.update({
          where: { id: message.id },
          data: { channelMessageId: String(sent.message_id) }
        });
      }
    } else if (chat.channel === Channel.MAX) {
      const sent = await sendMaxMessage(chat.externalChatId, data.text);
      if (sent?.mid) {
        await prisma.message.update({
          where: { id: message.id },
          data: { channelMessageId: sent.mid }
        });
      }
    }

    res.status(201).json(message);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/internal-notes', requirePermission('chats.write'), async (req, res, next) => {
  try {
    const schema = z.object({ content: z.string().min(1) });
    const data = schema.parse(req.body);

    const note = await prisma.internalNote.create({
      data: {
        chatId: req.params.id,
        authorId: req.auth!.userId,
        content: data.content
      }
    });

    res.status(201).json(note);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/status', requirePermission('chats.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.nativeEnum(ChatStatus),
      reason: z.string().optional()
    });

    const { status, reason } = schema.parse(req.body);

    const current = await prisma.chat.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    const updated = await prisma.chat.update({
      where: { id: req.params.id },
      data: {
        status: status as any,
        closedAt: status === ChatStatus.COMPLETED ? new Date() : null
      }
    });

    await prisma.chatStatusHistory.create({
      data: {
        chatId: updated.id,
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

router.patch('/:id/mode', requirePermission('chats.write'), async (req, res, next) => {
  try {
    const schema = z.object({ mode: z.nativeEnum(ChatMode) });
    const { mode } = schema.parse(req.body);

    const updated = await prisma.chat.update({
      where: { id: req.params.id },
      data: { mode: mode as any }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/state', requirePermission('chats.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      conversationState: z.string().optional(),
      currentScenarioCode: z.string().nullable().optional(),
      currentScenarioStep: z.string().nullable().optional(),
      scenarioData: z.unknown().nullable().optional(),
      sourceTransition: z.string().nullable().optional(),
      failedIntentCount: z.number().int().nonnegative().optional(),
      priority: z.string().optional(),
      status: z.nativeEnum(ChatStatus).optional()
    });

    const data = schema.parse(req.body);
    const updated = await prisma.chat.update({
      where: { id: req.params.id },
      data: {
        ...(data.conversationState !== undefined ? { conversationState: data.conversationState } : {}),
        ...(data.currentScenarioCode !== undefined ? { currentScenarioCode: data.currentScenarioCode } : {}),
        ...(data.currentScenarioStep !== undefined ? { currentScenarioStep: data.currentScenarioStep } : {}),
        ...(data.scenarioData !== undefined
          ? { scenarioData: data.scenarioData === null ? Prisma.JsonNull : (data.scenarioData as Prisma.InputJsonValue) }
          : {}),
        ...(data.sourceTransition !== undefined ? { sourceTransition: data.sourceTransition } : {}),
        ...(data.failedIntentCount !== undefined ? { failedIntentCount: data.failedIntentCount } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.status !== undefined ? { status: data.status as any } : {})
      }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/assign', requirePermission('chats.write'), async (req, res, next) => {
  try {
    const schema = z.object({ assignedUserId: z.string().nullable() });
    const data = schema.parse(req.body);

    const updated = await prisma.chat.update({
      where: { id: req.params.id },
      data: {
        assignedUserId: data.assignedUserId,
        status: (data.assignedUserId ? ChatStatus.ASSIGNED : ChatStatus.WAITING_MANAGER) as any
      }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
