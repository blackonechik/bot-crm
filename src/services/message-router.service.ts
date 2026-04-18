import { Channel, ChatMode, ChatStatus, MessageDirection } from '@prisma/client';
import { prisma } from '../db/prisma';

const URGENT_WORDS = ['сильная боль', 'кровь', 'плохо', 'срочно'];
const DISCLAIMER = 'Информация, предоставляемая ботом, носит справочный характер и не заменяет консультацию врача.';

type InboundPayload = {
  channel: Channel;
  externalUserId: string;
  externalChatId: string;
  username?: string;
  fullName?: string;
  text: string;
  raw?: unknown;
};

export type OutboundReply = {
  chatId: string;
  text: string;
};

function detectUrgent(text: string): boolean {
  const normalized = text.toLowerCase();
  return URGENT_WORDS.some((word) => normalized.includes(word));
}

export async function processInboundMessage(payload: InboundPayload): Promise<OutboundReply | null> {
  const { channel, externalUserId, externalChatId, fullName, username, text, raw } = payload;

  let client = await prisma.client.findFirst({
    where: channel === Channel.TELEGRAM ? { externalTgId: externalUserId } : { externalMaxId: externalUserId }
  });

  if (!client) {
    client = await prisma.client.create({
      data: channel === Channel.TELEGRAM
        ? { fullName, username, externalTgId: externalUserId, source: 'bot' }
        : { fullName, username, externalMaxId: externalUserId, source: 'bot' }
    });
  }

  const chat = await prisma.chat.upsert({
    where: {
      channel_externalChatId: {
        channel,
        externalChatId
      }
    },
    update: {},
    create: {
      channel,
      externalChatId,
      clientId: client.id,
      mode: ChatMode.AUTO,
      status: ChatStatus.BOT_IN_PROGRESS
    }
  });

  await prisma.message.create({
    data: {
      chatId: chat.id,
      text,
      direction: MessageDirection.INBOUND,
      senderClientId: client.id,
      metadata: raw as object | undefined
    }
  });

  const urgent = detectUrgent(text);
  if (urgent) {
    await prisma.chat.update({
      where: { id: chat.id },
      data: { isUrgent: true, priority: 'high', status: ChatStatus.WAITING_MANAGER }
    });

    await prisma.notification.create({
      data: {
        title: 'Срочное обращение',
        body: `Чат ${chat.id} отмечен как срочный`,
        type: 'urgent_chat',
        payload: { chatId: chat.id }
      }
    });

    return {
      chatId: chat.id,
      text: `${DISCLAIMER}\n\nВаше обращение отмечено как срочное. Пожалуйста, при необходимости свяжитесь с клиникой по телефону.`
    };
  }

  if (chat.mode === ChatMode.MANUAL || chat.mode === ChatMode.CLOSED) {
    return null;
  }

  const faq = await prisma.faqItem.findFirst({
    where: {
      isActive: true,
      OR: [
        { keywords: { hasSome: text.toLowerCase().split(/\s+/).filter(Boolean) } },
        { question: { contains: text, mode: 'insensitive' } },
        { aliases: { has: text.toLowerCase() } }
      ]
    }
  });

  const replyText = faq
    ? `${faq.answer}\n\n${DISCLAIMER}`
    : `${DISCLAIMER}\n\nСпасибо за сообщение. Мы получили ваш запрос и скоро ответим. Для записи на прием напишите: Запись на прием.`;

  if (faq) {
    await prisma.faqItem.update({ where: { id: faq.id }, data: { usageCount: { increment: 1 } } });
  }

  await prisma.message.create({
    data: {
      chatId: chat.id,
      text: replyText,
      direction: MessageDirection.OUTBOUND
    }
  });

  return {
    chatId: chat.id,
    text: replyText
  };
}
