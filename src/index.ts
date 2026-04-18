import { app } from './app';
import { env } from './config/env';
import { prisma } from './db/prisma';
import { startMaxBot, stopMaxBot } from './services/max-bot.service';
import { processDueScheduledTasks } from './services/scheduled-tasks.service';
import { startTelegramBot, stopTelegramBot } from './services/telegram-bot.service';

async function bootstrap(): Promise<void> {
  await prisma.$connect();

  const server = app.listen(env.port, async () => {
    console.log(`Backend started on http://localhost:${env.port}`);

    // Optional bot runtimes (long polling). Can coexist with webhook endpoints.
    void startTelegramBot().catch((error) => {
      console.warn('Telegram bot bootstrap failed', error);
    });
    void startMaxBot().catch((error) => {
      console.warn('MAX bot bootstrap failed', error);
    });
    setInterval(() => {
      processDueScheduledTasks().catch((error) => console.error('Scheduled task processing failed', error));
    }, 60_000).unref();
  });

  const shutdown = async () => {
    await stopTelegramBot();
    await stopMaxBot();
    await prisma.$disconnect();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(async (e) => {
  console.error('Failed to bootstrap backend', e);
  await prisma.$disconnect();
  process.exit(1);
});
