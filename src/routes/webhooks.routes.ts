import { Router } from 'express';
import { prisma } from '../db/prisma';
import { publishLiveEvent } from '../services/realtime.service';
import { processInboundMessage } from '../services/message-router.service';
import { sendMaxMessage } from '../services/max-bot.service';
import { sendTelegramMessage } from '../services/telegram-bot.service';
import { Channel } from '../types/domain';

const router = Router();

router.post('/telegram', async (req, res, next) => {
  try {
    const update = req.body;

    const callbackQuery = update?.callback_query;
    const message = update?.message;
    const text = message?.text ?? callbackQuery?.data;
    if ((!message && !callbackQuery) || !text) {
      res.status(200).json({ ok: true });
      return;
    }

    const sourceMessage = message ?? callbackQuery?.message;
    const from = message?.from ?? callbackQuery?.from;

    const reply = await processInboundMessage({
      channel: Channel.TELEGRAM,
      externalUserId: String(from.id),
      externalChatId: String(sourceMessage.chat.id),
      username: from.username,
      fullName: [from.first_name, from.last_name].filter(Boolean).join(' '),
      text,
      raw: update
    });

    if (reply) {
      await sendTelegramMessage(String(sourceMessage.chat.id), reply.text, reply.buttons);
    }

    publishLiveEvent({ type: 'workspace:update', chatId: String(sourceMessage.chat.id), entity: 'chat', timestamp: new Date().toISOString() });

    await prisma.webhookLog.create({
      data: {
        channel: Channel.TELEGRAM,
        eventType: callbackQuery ? 'callback_query' : 'message',
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
    const callback = payload?.callback ?? payload?.message_callback?.callback;
    const text = message?.body?.text ?? message?.text ?? callback?.payload;

    if (!text) {
      res.status(200).json({ ok: true });
      return;
    }

    const reply = await processInboundMessage({
      channel: Channel.MAX,
      externalUserId: String(message?.sender?.user_id ?? message?.sender?.id ?? callback?.user?.user_id ?? 'unknown'),
      externalChatId: String(message?.recipient?.chat_id ?? message?.chat_id ?? payload?.chat_id ?? 'unknown'),
      username: message?.sender?.username,
      fullName: message?.sender?.name,
      text,
      raw: payload
    });

    if (reply) {
      await sendMaxMessage(String(message?.recipient?.chat_id ?? message?.chat_id ?? payload?.chat_id ?? 'unknown'), reply.text, reply.buttons);
    }

    publishLiveEvent({
      type: 'workspace:update',
      chatId: String(message?.recipient?.chat_id ?? message?.chat_id ?? payload?.chat_id ?? 'unknown'),
      entity: 'chat',
      timestamp: new Date().toISOString()
    });

    await prisma.webhookLog.create({
      data: {
        channel: Channel.MAX,
        eventType: callback ? 'message_callback' : 'message_created',
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
