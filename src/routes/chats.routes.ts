import { ChatMode, ChatStatus, MessageDirection } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

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
        channel: channel as any,
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

    const message = await prisma.message.create({
      data: {
        chatId: req.params.id,
        text: data.text,
        direction: MessageDirection.OUTBOUND,
        senderUserId: req.auth!.userId
      }
    });

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
        status,
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
      data: { mode }
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
        status: data.assignedUserId ? ChatStatus.ASSIGNED : ChatStatus.WAITING_MANAGER
      }
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
