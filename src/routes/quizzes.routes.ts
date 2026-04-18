import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';
import { Channel, ChatStatus, LeadStatus } from '../types/domain';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('quiz.read'), async (_req, res, next) => {
  try {
    const forms = await prisma.quizForm.findMany({
      include: { questions: { orderBy: { order: 'asc' } }, answers: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(forms);
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePermission('quiz.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().min(2),
      description: z.string().optional(),
      isActive: z.boolean().default(true)
    });
    const data = schema.parse(req.body);
    const created = await prisma.quizForm.create({ data });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.post('/:formId/questions', requirePermission('quiz.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      text: z.string().min(1),
      type: z.string().min(1),
      isRequired: z.boolean().default(false),
      options: z.array(z.string()).default([]),
      order: z.number().int().nonnegative()
    });
    const data = schema.parse(req.body);
    const question = await prisma.quizQuestion.create({
      data: {
        formId: req.params.formId,
        ...data
      }
    });
    res.status(201).json(question);
  } catch (e) {
    next(e);
  }
});

router.post('/:formId/submit', async (req, res, next) => {
  try {
    const schema = z.object({
      clientId: z.string().optional(),
      chatId: z.string().optional(),
      answers: z.record(z.any()),
      createLead: z.boolean().default(false),
      leadComment: z.string().optional(),
      fullName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      username: z.string().optional(),
      company: z.string().optional(),
      interest: z.string().optional(),
      source: z.string().optional()
    });
    const data = schema.parse(req.body);

    let clientId = data.clientId;
    if (!clientId && (data.phone || data.email || data.username || data.fullName)) {
      const client = await prisma.client.create({
        data: {
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          username: data.username,
          company: data.company,
          source: data.source
        }
      });
      clientId = client.id;
    }

    const answer = await prisma.quizAnswer.create({
      data: {
        formId: req.params.formId,
        clientId,
        chatId: data.chatId,
        answers: data.answers
      }
    });

    let lead = null;
    if (data.createLead && clientId) {
      let leadChatId = data.chatId;
      if (!leadChatId) {
        const leadChat = await prisma.chat.create({
          data: {
            channel: Channel.TELEGRAM,
            externalChatId: `quiz-${answer.id}`,
            clientId,
            status: ChatStatus.NEW,
            conversationState: 'new'
          }
        });
        leadChatId = leadChat.id;
      }

      lead = await prisma.lead.create({
        data: {
          clientId,
          chatId: leadChatId,
          channel: Channel.TELEGRAM,
          source: data.source ?? 'quiz',
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          username: data.username,
          company: data.company,
          comment: data.leadComment,
          interest: data.interest
        }
      });

      await prisma.leadStatusHistory.create({
        data: {
          leadId: lead.id,
          toStatus: LeadStatus.NEW,
          changedById: undefined,
          reason: 'Created from quiz'
        }
      });
    }

    res.status(201).json({ answer, lead });
  } catch (e) {
    next(e);
  }
});

export default router;
