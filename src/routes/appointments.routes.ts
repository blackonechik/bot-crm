import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';
import { AppointmentStatus, ChatStatus } from '../types/domain';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('appointments.read'), async (_req, res, next) => {
  try {
    const items = await prisma.appointment.findMany({
      include: {
        client: true,
        chat: true,
        lead: true,
        assignedUser: { select: { id: true, name: true, email: true } }
      },
      orderBy: { scheduledAt: 'desc' }
    });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('appointments.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      clientId: z.string().optional(),
      chatId: z.string().optional(),
      leadId: z.string().optional(),
      assignedUserId: z.string().optional(),
      service: z.string().min(2),
      doctor: z.string().optional(),
      scheduledAt: z.string().datetime(),
      comment: z.string().optional(),
      createLead: z.boolean().default(false),
      fullName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      username: z.string().optional(),
      source: z.string().optional()
    });

    const data = schema.parse(req.body);
    let clientId = data.clientId;
    if (!clientId && (data.fullName || data.phone || data.email || data.username)) {
      const client = await prisma.client.create({
        data: {
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          username: data.username,
          source: data.source ?? 'appointment'
        }
      });
      clientId = client.id;
    }

    const appointment = await prisma.appointment.create({
      data: {
        clientId,
        chatId: data.chatId,
        leadId: data.leadId,
        assignedUserId: data.assignedUserId,
        service: data.service,
        doctor: data.doctor,
        scheduledAt: new Date(data.scheduledAt),
        comment: data.comment
      }
    });

    const scheduledAt = new Date(data.scheduledAt);
    await prisma.scheduledTask.createMany({
      data: [
        {
          type: 'appointment_reminder_24h',
          runAt: new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000),
          payload: { appointmentId: appointment.id }
        },
        {
          type: 'appointment_reminder_2h',
          runAt: new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000),
          payload: { appointmentId: appointment.id }
        }
      ]
    });

    if (data.createLead && clientId && !data.leadId) {
      let leadChatId = data.chatId;
      if (!leadChatId) {
        const leadChat = await prisma.chat.create({
          data: {
            channel: 'TELEGRAM',
            externalChatId: `appointment-${appointment.id}`,
            clientId,
            status: 'APPOINTMENT'
          }
        });
        leadChatId = leadChat.id;
      }

      await prisma.lead.create({
        data: {
          clientId,
          chatId: leadChatId,
          channel: 'TELEGRAM',
          source: data.source ?? 'appointment',
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          username: data.username,
          interest: data.service,
          comment: data.comment
        }
      });
    }

    await prisma.notification.create({
      data: {
        title: 'Новая запись на прием',
        body: `Создана запись на ${data.service}`,
        type: 'appointment_created',
        payload: { appointmentId: appointment.id }
      }
    });

    res.status(201).json(appointment);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/status', requirePermission('appointments.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['REQUESTED', 'WAITING_CONFIRMATION', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED'])
    });
    const { status } = schema.parse(req.body);
    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status }
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/confirm', requirePermission('appointments.write'), async (req, res, next) => {
  try {
    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status: AppointmentStatus.CONFIRMED as any }
    });

    if (appointment.chatId) {
      await prisma.chat.update({
        where: { id: appointment.chatId },
        data: { status: ChatStatus.CONFIRMED as any }
      });
    }

    res.json(appointment);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/cancel', requirePermission('appointments.write'), async (req, res, next) => {
  try {
    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status: AppointmentStatus.CANCELLED as any }
    });

    if (appointment.chatId) {
      await prisma.chat.update({
        where: { id: appointment.chatId },
        data: { status: ChatStatus.CANCELLED as any }
      });
    }

    res.json(appointment);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/reschedule', requirePermission('appointments.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      scheduledAt: z.string().datetime()
    });
    const { scheduledAt } = schema.parse(req.body);

    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        status: AppointmentStatus.RESCHEDULED as any,
        scheduledAt: new Date(scheduledAt)
      }
    });

    if (appointment.chatId) {
      await prisma.chat.update({
        where: { id: appointment.chatId },
        data: { status: ChatStatus.RESCHEDULED as any }
      });
    }

    res.json(appointment);
  } catch (e) {
    next(e);
  }
});

export default router;
