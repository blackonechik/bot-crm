import { Router } from 'express';
import { prisma } from '../db/prisma';
import { processInboundMessage } from '../services/message-router.service';
import { Channel } from '../types/domain';

const router = Router();

router.post('/telegram', async (req, res, next) => {
  try {
    const update = req.body;

    const message = update?.message;
    const text = message?.text;
    if (!message || !text) {
      res.status(200).json({ ok: true });
      return;
    }

    const reply = await processInboundMessage({
      channel: Channel.TELEGRAM,
      externalUserId: String(message.from.id),
      externalChatId: String(message.chat.id),
      username: message.from.username,
      fullName: [message.from.first_name, message.from.last_name].filter(Boolean).join(' '),
      text,
      raw: update
    });

    await prisma.webhookLog.create({
      data: {
        channel: Channel.TELEGRAM,
        eventType: 'message',
        payload: update,
        status: 'processed'
      }
    });

    res.json({ ok: true, reply });
  } catch (e: any) {
    await prisma.webhookLog.create({
      data: {
        channel: Channel.TELEGRAM,
        eventType: 'message',
        payload: req.body,
        status: 'failed',
        error: String(e?.message ?? e)
      }
    });
    next(e);
  }
});

router.post('/max', async (req, res, next) => {
  try {
    const payload = req.body;
    const message = payload?.message ?? payload;
    const text = message?.body?.text ?? message?.text;

    if (!text) {
      res.status(200).json({ ok: true });
      return;
    }

    const reply = await processInboundMessage({
      channel: Channel.MAX,
      externalUserId: String(message?.sender?.user_id ?? message?.sender?.id ?? 'unknown'),
      externalChatId: String(message?.recipient?.chat_id ?? message?.chat_id ?? 'unknown'),
      username: message?.sender?.username,
      fullName: message?.sender?.name,
      text,
      raw: payload
    });

    await prisma.webhookLog.create({
      data: {
        channel: Channel.MAX,
        eventType: 'message_created',
        payload,
        status: 'processed'
      }
    });

    res.json({ ok: true, reply });
  } catch (e: any) {
    await prisma.webhookLog.create({
      data: {
        channel: Channel.MAX,
        eventType: 'message_created',
        payload: req.body,
        status: 'failed',
        error: String(e?.message ?? e)
      }
    });
    next(e);
  }
});

export default router;
