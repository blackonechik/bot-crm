import type { Response } from 'express';
import { prisma } from '../db/prisma';
import { verifyAccessToken } from '../utils/jwt';

const subscribers = new Set<Response>();

export type LiveEvent = {
  type: string;
  chatId?: string;
  leadId?: string;
  clientId?: string;
  entity?: string;
  timestamp: string;
  payload?: unknown;
};

export async function authenticateLiveToken(token: string): Promise<boolean> {
  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    return Boolean(user && user.isActive);
  } catch {
    return false;
  }
}

export function subscribeLiveClient(res: Response): void {
  subscribers.add(res);
  res.write('retry: 3000\n\n');

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
  });
}

export function publishLiveEvent(event: LiveEvent): void {
  const message = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const subscriber of subscribers) {
    try {
      subscriber.write(message);
    } catch {
      subscribers.delete(subscriber);
    }
  }
}
