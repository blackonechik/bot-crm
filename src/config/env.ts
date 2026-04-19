import dotenv from 'dotenv';

dotenv.config();

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: getEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/bot_crm?schema=public'),
  accessSecret: getEnv('JWT_ACCESS_SECRET', 'change_me_access'),
  refreshSecret: getEnv('JWT_REFRESH_SECRET', 'change_me_refresh'),
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '7d',
  maxBotToken: process.env.MAX_BOT_TOKEN,
  tgBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramProxyUrl: process.env.TELEGRAM_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY,
  timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Moscow'
};
