import { Telegraf } from 'telegraf';
import { env } from '../config/env';
import { Channel } from '../types/domain';
import { processInboundMessage } from './message-router.service';
import { telegramInlineKeyboard } from '../utils/inline-keyboard';

const { HttpsProxyAgent } = require('https-proxy-agent');

let telegramBot: Telegraf | null = null;

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  buttons?: string[]
): Promise<{ message_id?: number } | null> {
  if (!telegramBot) {
    console.warn('Telegram bot is not started, cannot send message');
    return null;
  }

  if (!/^-?\d+$/.test(chatId)) {
    console.warn(`Telegram chat id is not numeric, skipping send: ${chatId}`);
    return null;
  }

  const extra = buttons && buttons.length > 0 ? telegramInlineKeyboard(buttons) : undefined;
  const message = await telegramBot.telegram.sendMessage(chatId, text, extra as any);
  return { message_id: message.message_id };
}

async function sendReply(ctx: any, reply: { text: string; buttons?: string[] }) {
  await sendTelegramMessage(String(ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id ?? 'unknown'), reply.text, reply.buttons);
}

export async function startTelegramBot(): Promise<void> {
  if (!env.tgBotToken) {
    console.warn('TELEGRAM_BOT_TOKEN not set, Telegram bot disabled');
    return;
  }

  const telegramOptions = env.telegramProxyUrl
    ? {
        telegram: {
          agent: new HttpsProxyAgent(env.telegramProxyUrl)
        }
      }
    : undefined;

  telegramBot = new Telegraf(env.tgBotToken, telegramOptions);

  telegramBot.start(async (ctx) => {
    const reply = await processInboundMessage({
      channel: Channel.TELEGRAM,
      externalUserId: String(ctx.from?.id ?? 'unknown'),
      externalChatId: String(ctx.chat?.id ?? 'unknown'),
      username: ctx.from?.username,
      fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' '),
      text: '/start',
      raw: ctx.update
    });

    if (reply) {
      await sendReply(ctx as any, reply);
    }
  });

  telegramBot.on('text', async (ctx) => {
    const from = ctx.message.from;
    const reply = await processInboundMessage({
      channel: Channel.TELEGRAM,
      externalUserId: String(from.id),
      externalChatId: String(ctx.chat.id),
      username: from.username,
      fullName: [from.first_name, from.last_name].filter(Boolean).join(' '),
      text: ctx.message.text,
      raw: ctx.update
    });

    if (reply) {
      await sendReply(ctx as any, reply);
    }
  });

  telegramBot.action(/.*/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const payload = (ctx.callbackQuery as any)?.data;
    if (!payload) return;

    const reply = await processInboundMessage({
      channel: Channel.TELEGRAM,
      externalUserId: String(ctx.from?.id ?? 'unknown'),
      externalChatId: String(ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id ?? 'unknown'),
      username: ctx.from?.username,
      fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' '),
      text: payload,
      raw: ctx.update
    });

    if (reply) {
      await sendReply(ctx as any, reply);
    }
  });

  try {
    await telegramBot.launch();
    console.log('Telegram bot started (Telegraf)');
  } catch (error) {
    console.warn('Telegram bot failed to start, continuing without polling', error);
    telegramBot = null;
  }
}

export async function stopTelegramBot(): Promise<void> {
  if (telegramBot) {
    await telegramBot.stop();
    telegramBot = null;
  }
}
