import { env } from '../config/env';
import { Channel } from '../types/domain';
import { processInboundMessage } from './message-router.service';

let botInstance: any = null;

export async function startMaxBot(): Promise<void> {
  if (!env.maxBotToken) {
    console.warn('MAX_BOT_TOKEN not set, MAX bot disabled');
    return;
  }

  // Official library: @maxhub/max-bot-api (per MAX docs)
  const { Bot } = require('@maxhub/max-bot-api');
  const bot = new Bot(env.maxBotToken);

  bot.command('start', async (ctx: any) => {
    await ctx.reply('Добро пожаловать в клинику. Чем могу помочь?');
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
      await ctx.reply(reply.text);
    }
  });

  bot.start();
  botInstance = bot;
  console.log('MAX bot started (@maxhub/max-bot-api)');
}

export async function stopMaxBot(): Promise<void> {
  if (!botInstance) return;
  if (typeof botInstance.stop === 'function') {
    await botInstance.stop();
  }
  botInstance = null;
}
