import { env } from '../config/env';
import { Channel } from '../types/domain';
import { processInboundMessage } from './message-router.service';
import { maxInlineKeyboard } from '../utils/inline-keyboard';

let maxBot: any = null;

export async function sendMaxMessage(
  chatId: string,
  text: string,
  buttons?: string[]
): Promise<{ mid?: string } | null> {
  if (!maxBot) {
    console.warn('MAX bot is not started, cannot send message');
    return null;
  }

  if (!/^\d+$/.test(chatId)) {
    console.warn(`MAX chat id is not numeric, skipping send: ${chatId}`);
    return null;
  }

  const extra = buttons && buttons.length > 0 ? { attachments: [maxInlineKeyboard(buttons)] } : undefined;
  const numericChatId = Number(chatId);
  const message = await maxBot.api.sendMessageToChat(numericChatId, text, extra);
  return { mid: message?.body?.mid };
}

async function sendReply(ctx: any, reply: { text: string; buttons?: string[] }) {
  await sendMaxMessage(String(ctx.chatId ?? ctx.message?.chat_id ?? 'unknown'), reply.text, reply.buttons);
}

export async function startMaxBot(): Promise<void> {
  if (!env.maxBotToken) {
    console.warn('MAX_BOT_TOKEN not set, MAX bot disabled');
    return;
  }

  // Official library: @maxhub/max-bot-api (per MAX docs)
  const { Bot } = require('@maxhub/max-bot-api');
  const bot = new Bot(env.maxBotToken);
  maxBot = bot;

  bot.command('start', async (ctx: any) => {
    const reply = await processInboundMessage({
      channel: Channel.MAX,
      externalUserId: String(ctx.user?.user_id ?? ctx.user?.id ?? 'unknown'),
      externalChatId: String(ctx.chatId ?? ctx.message?.chat_id ?? 'unknown'),
      username: ctx.user?.username,
      fullName: ctx.user?.name,
      text: '/start',
      raw: ctx.update
    });

    if (reply) {
      await sendReply(ctx, reply);
    }
  });

  bot.on('message_created', async (ctx: any) => {
    const message = ctx.message;
    const from = message?.sender ?? {};
    const text = message?.body?.text ?? '';

    if (!text) return;

    const reply = await processInboundMessage({
      channel: Channel.MAX,
      externalUserId: String(from.user_id ?? from.id ?? 'unknown'),
      externalChatId: String(message?.recipient?.chat_id ?? message?.chat_id ?? 'unknown'),
      username: from.username,
      fullName: from.name,
      text,
      raw: message
    });

    if (reply) {
      await sendReply(ctx, reply);
    }
  });

  bot.action(/.*/, async (ctx: any) => {
    await ctx.answerOnCallback({}).catch(() => undefined);
    const payload = ctx.callback?.payload;
    if (!payload) return;

    const reply = await processInboundMessage({
      channel: Channel.MAX,
      externalUserId: String(ctx.user?.user_id ?? ctx.user?.id ?? 'unknown'),
      externalChatId: String(ctx.chatId ?? ctx.message?.chat_id ?? 'unknown'),
      username: ctx.user?.username,
      fullName: ctx.user?.name,
      text: payload,
      raw: ctx.update
    });

    if (reply) {
      await sendReply(ctx, reply);
    }
  });

  try {
    await bot.start();
    console.log('MAX bot started (@maxhub/max-bot-api)');
  } catch (error) {
    console.warn('MAX bot failed to start, continuing without polling', error);
    maxBot = null;
  }
}

export async function stopMaxBot(): Promise<void> {
  if (!maxBot) return;
  if (typeof maxBot.stop === 'function') {
    await maxBot.stop();
  }
  maxBot = null;
}
