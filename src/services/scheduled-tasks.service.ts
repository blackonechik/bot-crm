import { ChatStatus, MessageDirection } from '@prisma/client';
import { prisma } from '../db/prisma';

function safeJson(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

async function sendReminderMessage(chatId: string, text: string): Promise<void> {
  await prisma.message.create({
    data: {
      chatId,
      text,
      direction: MessageDirection.OUTBOUND as any
    }
  });
}

export async function processDueScheduledTasks(): Promise<void> {
  const now = new Date();
  const tasks = await prisma.scheduledTask.findMany({
    where: { isProcessed: false, runAt: { lte: now } },
    orderBy: { runAt: 'asc' },
    take: 50
  });

  for (const task of tasks) {
    try {
      const payload = safeJson(task.payload);
      const appointmentId = typeof payload?.appointmentId === 'string' ? payload.appointmentId : null;
      const appointment = appointmentId
        ? await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { chat: true } })
        : null;

      if (task.type.startsWith('appointment_reminder') && appointment && appointment.chatId) {
        const time = appointment.scheduledAt.toTimeString().slice(0, 5);
        const baseText =
          task.type === 'appointment_reminder_24h'
            ? `Напоминаем, что вы записаны в клинику.\nВрач: ${appointment.doctor ?? 'не указан'}\nДата: ${appointment.scheduledAt.toLocaleDateString('ru-RU')}\nВремя: ${time}`
            : `Напоминаем о вашем приеме сегодня в ${time}.\nЖдем вас в клинике.`;

        await sendReminderMessage(appointment.chatId, baseText);
        await prisma.notification.create({
          data: {
            title: 'Напоминание о приеме',
            body: baseText,
            type: task.type,
            payload: { appointmentId: appointment.id }
          }
        });

        await prisma.chat.update({
          where: { id: appointment.chatId },
          data: {
            status: task.type === 'appointment_reminder_24h' ? ChatStatus.WAITING_CONFIRMATION : ChatStatus.CONFIRMED
          }
        });
      }

      if (task.type === 'sla_first_response_30m' && payload?.chatId && typeof payload.chatId === 'string') {
        const chat = await prisma.chat.findUnique({
          where: { id: payload.chatId },
          select: { id: true, firstResponseAt: true, mode: true }
        });

        if (chat && !chat.firstResponseAt) {
          await prisma.chat.update({
            where: { id: chat.id },
            data: {
              mode: 'MANUAL',
              status: ChatStatus.WAITING_MANAGER,
              conversationState: 'human_handoff_waiting',
              sourceTransition: 'sla_first_response_timeout',
              priority: 'high',
              pausedAt: new Date()
            }
          });

          await prisma.notification.create({
            data: {
              title: 'SLA: первый ответ просрочен',
              body: `Чат ${chat.id} требует первоочередного ответа`,
              type: 'sla_breach',
              payload: { chatId: chat.id }
            }
          });

          await sendReminderMessage(chat.id, 'Извините за ожидание. Мы уже передали ваш запрос администратору.');
        }
      }

      if (task.type.startsWith('scenario_timeout') && payload?.chatId && typeof payload.chatId === 'string') {
        await prisma.chat.update({
          where: { id: payload.chatId },
          data: {
            pausedAt: new Date(),
            conversationState: 'main_menu',
            sourceTransition: task.type
          }
        });
        await sendReminderMessage(payload.chatId, 'Если вам сейчас неудобно, вы можете вернуться позже. Я сохраню текущий этап диалога.');
      }

      await prisma.scheduledTask.update({ where: { id: task.id }, data: { isProcessed: true } });
    } catch (error) {
      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          isProcessed: true,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
}
