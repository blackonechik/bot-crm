import { Telegraf } from 'telegraf';
import { env } from '../config/env';
import { Channel } from '@prisma/client';
import { processInboundMessage } from './message-router.service';

let bot: Telegraf | null = null;

export async function startTelegramBot(): Promise<void> {
  if (!env.tgBotToken) {
    console.warn('TELEGRAM_BOT_TOKEN not set, Telegram bot disabled');
    return;
  }

  bot = new Telegraf(env.tgBotToken);

  bot.start(async (ctx) => {
    await ctx.reply('Добро пожаловать в клинику. Чем могу помочь?');
  });

  bot.on('text', async (ctx) => {
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
      await ctx.reply(reply.text);
    }
  });

  await bot.launch();
  console.log('Telegram bot started (Telegraf)');
}

export async function stopTelegramBot(): Promise<void> {
  if (bot) {
    await bot.stop();
    bot = null;
  }
}
