import { AppointmentStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getAvailableAppointmentSlots } from './appointment-slots.service';
import { Channel, ChatMode, ChatStatus, ConversationState, MessageDirection } from '../types/domain';
import { publishLiveEvent } from './realtime.service';

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
  buttons?: string[];
};

type ClinicProfileShape = {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  site?: string | null;
  workingHours?: unknown;
  welcomeText?: string | null;
  mainMenuText?: string | null;
  fallbackText?: string | null;
  afterHoursText?: string | null;
  urgentText?: string | null;
  handoffText?: string | null;
  disclaimerText?: string | null;
  appointmentButtons?: unknown;
  doctors?: unknown;
  services?: unknown;
  triggerWords?: unknown;
};

type ScenarioData = Record<string, unknown>;

const DEFAULT_DISCLAIMER =
  'Информация, предоставляемая ботом, носит справочный характер и не заменяет консультацию врача.';

const MANAGER_WORDS = ['менеджер', 'оператор', 'человек', 'связаться', 'администратор', 'жалоба', 'жалоб'];
const URGENT_WORDS = ['срочно', 'сильная боль', 'кровь', 'плохо', 'экстренно', 'не могу дышать', 'очень больно', 'высокая температура', 'потеря сознания'];
const BOOKING_WORDS = ['запис', 'прием', 'приём', 'консультац'];
const PRICE_WORDS = ['стоим', 'цен', 'прайс'];
const DOCTOR_WORDS = ['врач', 'специалист', 'доктор'];
const CLINIC_INFO_WORDS = ['график', 'адрес', 'телефон', 'сайт', 'контак'];
const CONTACT_WORDS = ['перезвон', 'контакт', 'телефон'];
const YES_WORDS = ['да', 'подтверд', 'верно', 'ок', 'согласен', 'согласна'];
const NO_WORDS = ['нет', 'не нужно', 'отмена', 'не надо'];

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function extractAttachments(raw: unknown): Array<{ fileName?: string; mimeType?: string; url?: string; size?: number; metadata?: unknown }> {
  const payload = raw as { attachments?: unknown; files?: unknown; photo?: unknown; document?: unknown } | undefined;
  const attachments: Array<{ fileName?: string; mimeType?: string; url?: string; size?: number; metadata?: unknown }> = [];

  const list = Array.isArray(payload?.attachments)
    ? payload?.attachments
    : Array.isArray(payload?.files)
      ? payload?.files
      : [];

  for (const item of list as Array<Record<string, unknown>>) {
    attachments.push({
      fileName: typeof item.file_name === 'string' ? item.file_name : typeof item.name === 'string' ? item.name : undefined,
      mimeType: typeof item.mime_type === 'string' ? item.mime_type : typeof item.type === 'string' ? item.type : undefined,
      url: typeof item.url === 'string' ? item.url : typeof item.file_url === 'string' ? item.file_url : undefined,
      size: typeof item.size === 'number' ? item.size : undefined,
      metadata: item
    });
  }

  if (payload?.photo) {
    attachments.push({ metadata: payload.photo });
  }

  if (payload?.document) {
    attachments.push({ metadata: payload.document });
  }

  return attachments;
}

async function getClinicProfile(): Promise<ClinicProfileShape> {
  const profile = await prisma.clinicProfile.findFirst({
    orderBy: { createdAt: 'asc' }
  });

  if (profile) {
    return profile as ClinicProfileShape;
  }

  return {
    id: 'default',
    name: 'Клиника',
    address: 'Не задано',
    phone: '+7 (000) 000-00-00',
    site: 'https://example.com',
    welcomeText: 'Здравствуйте! Добро пожаловать в клинику.',
    mainMenuText: 'Чем я могу помочь?',
    fallbackText: 'Я не совсем понял запрос. Выберите, пожалуйста, один из вариантов меню.',
    afterHoursText: 'Вы обратились вне рабочего времени клиники.',
    urgentText: 'Понимаю, что ситуация может быть срочной.',
    handoffText: 'Я передал ваш запрос администратору. Пожалуйста, ожидайте ответа.',
    disclaimerText: DEFAULT_DISCLAIMER,
    appointmentButtons: ['Записаться на прием', 'Узнать стоимость', 'Выбрать врача', 'График и адрес', 'Связаться с администратором'],
    doctors: [],
    services: [],
    triggerWords: URGENT_WORDS
  };
}

function getDisclaimer(profile: ClinicProfileShape): string {
  return profile.disclaimerText?.trim() || DEFAULT_DISCLAIMER;
}

function getMenuButtons(): string[] {
  return ['Записаться на прием', 'Узнать стоимость', 'Выбрать врача', 'График и адрес', 'Связаться с администратором'];
}

function getClinicInfo(profile: ClinicProfileShape): string {
  return [
    `Вот информация о клинике:`,
    `Адрес: ${profile.address ?? 'не указан'}`,
    `График работы: ${(profile.workingHours as string | undefined) ?? 'не указан'}`,
    `Телефон: ${profile.phone ?? 'не указан'}`,
    `Сайт: ${profile.site ?? 'не указан'}`
  ].join('\n');
}

function isWorkingNow(profile: ClinicProfileShape, now = new Date()): boolean {
  const hours = profile.workingHours as Record<string, string> | undefined;
  if (!hours) return true;

  const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const key = weekdayKeys[now.getDay()];
  const schedule = hours[key];
  if (!schedule || schedule === 'closed') return false;

  const match = schedule.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!match) return true;

  const current = now.toTimeString().slice(0, 5);
  return current >= match[1] && current <= match[2];
}

function parseDateCandidate(text: string): Date | null {
  const normalized = text.trim();
  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = normalized.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePhone(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10) {
    return `+7${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+${digits}`;
  }
  if (digits.length > 11) {
    return `+${digits}`;
  }
  return null;
}

function findServiceAnswer(profile: ClinicProfileShape, text: string): { name: string; price: string } | null {
  const services = Array.isArray(profile.services) ? (profile.services as Array<{ name?: string; price?: string }>) : [];
  const normalized = normalizeText(text);
  const found = services.find((service) => {
    const candidate = normalizeText(service.name ?? '');
    return candidate && (normalized.includes(candidate) || candidate.includes(normalized));
  });

  if (!found || !found.name || !found.price) return null;
  return { name: found.name, price: found.price };
}

function findDoctors(profile: ClinicProfileShape, specialization?: string): Array<Record<string, unknown>> {
  const doctors = Array.isArray(profile.doctors) ? (profile.doctors as Array<Record<string, unknown>>) : [];
  if (!specialization) return doctors;
  const normalized = normalizeText(specialization);
  return doctors.filter((doctor) => normalizeText(String(doctor.specialization ?? '')).includes(normalized));
}

async function logOutboundMessage(chatId: string, text: string): Promise<void> {
  await prisma.message.create({
    data: {
      chatId,
      text,
      direction: MessageDirection.OUTBOUND as any
    }
  });

  await prisma.chat.updateMany({
    where: { id: chatId, firstResponseAt: null },
    data: { firstResponseAt: new Date() }
  });
}

async function updateChatState(
  chatId: string,
  data: Partial<{
    status: ChatStatus;
    mode: ChatMode;
    conversationState: ConversationState | string;
    currentScenarioCode: string | null;
    currentScenarioStep: string | null;
    scenarioData: ScenarioData | null;
    sourceTransition: string | null;
    failedIntentCount: number;
    priority: string;
    isUrgent: boolean;
    pausedAt: Date | null;
    lastBotMessageAt: Date | null;
    lastUserMessageAt: Date | null;
  }>
): Promise<void> {
  await prisma.chat.update({
    where: { id: chatId },
    data: {
      ...(data.status !== undefined ? { status: data.status as any } : {}),
      ...(data.mode !== undefined ? { mode: data.mode as any } : {}),
      ...(data.conversationState !== undefined ? { conversationState: String(data.conversationState) } : {}),
      ...(data.currentScenarioCode !== undefined ? { currentScenarioCode: data.currentScenarioCode } : {}),
      ...(data.currentScenarioStep !== undefined ? { currentScenarioStep: data.currentScenarioStep } : {}),
      ...(data.scenarioData !== undefined
        ? {
            scenarioData:
              data.scenarioData === null ? Prisma.JsonNull : (data.scenarioData as Prisma.InputJsonValue)
          }
        : {}),
      ...(data.sourceTransition !== undefined ? { sourceTransition: data.sourceTransition } : {}),
      ...(data.failedIntentCount !== undefined ? { failedIntentCount: data.failedIntentCount } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.isUrgent !== undefined ? { isUrgent: data.isUrgent } : {}),
      ...(data.pausedAt !== undefined ? { pausedAt: data.pausedAt } : {}),
      ...(data.lastBotMessageAt !== undefined ? { lastBotMessageAt: data.lastBotMessageAt } : {}),
      ...(data.lastUserMessageAt !== undefined ? { lastUserMessageAt: data.lastUserMessageAt } : {})
    }
  });
}

async function ensureActiveChat(payload: InboundPayload) {
  const { channel, externalUserId, externalChatId, fullName, username } = payload;
  const existingChat = await prisma.chat.findUnique({
    where: {
      channel_externalChatId: {
        channel,
        externalChatId
      }
    },
    select: { id: true }
  });

  let client = await prisma.client.findFirst({
    where: channel === Channel.TELEGRAM ? { externalTgId: externalUserId } : { externalMaxId: externalUserId }
  });

  if (!client) {
    client = await prisma.client.create({
      data:
        channel === Channel.TELEGRAM
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
    update: {
      lastUserMessageAt: new Date(),
      clientId: client.id
    },
    create: {
      channel: channel as any,
      externalChatId,
      clientId: client.id,
      mode: ChatMode.AUTO as any,
      status: ChatStatus.NEW as any,
      conversationState: ConversationState.NEW,
      failedIntentCount: 0
    }
  });

  if (!existingChat) {
    await prisma.scheduledTask.create({
      data: {
        type: 'sla_first_response_30m',
        runAt: new Date(Date.now() + 30 * 60 * 1000),
        payload: { chatId: chat.id }
      }
    });
  }

  return { client, chat };
}

async function storeInboundMessage(chatId: string, clientId: string, text: string, raw: unknown): Promise<string> {
  const message = await prisma.message.create({
    data: {
      chatId,
      text,
      direction: MessageDirection.INBOUND as any,
      senderClientId: clientId,
      metadata: raw as object | undefined
    }
  });

  for (const attachment of extractAttachments(raw)) {
    await prisma.messageAttachment.create({
      data: {
        messageId: message.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        url: attachment.url,
        size: attachment.size,
        metadata: attachment.metadata as object | undefined
      }
    });
  }

  return message.id;
}

async function handleHumanHandoff(chatId: string, profile: ClinicProfileShape, reason: string): Promise<OutboundReply> {
  await updateChatState(chatId, {
    status: ChatStatus.WAITING_MANAGER,
    mode: ChatMode.MANUAL,
    conversationState: ConversationState.HUMAN_HANDOFF_WAITING,
    currentScenarioCode: null,
    currentScenarioStep: null,
    scenarioData: null,
    sourceTransition: reason,
    failedIntentCount: 0,
    priority: 'high'
  });

  await prisma.notification.create({
    data: {
      title: 'Новое обращение',
      body: `Чат ${chatId} передан администратору`,
      type: 'human_handoff',
      payload: { chatId, reason }
    }
  });

  return {
    chatId,
    text: `${profile.handoffText ?? 'Я передал ваш запрос администратору. Пожалуйста, ожидайте ответа.'}`
  };
}

async function handleUrgent(chatId: string, profile: ClinicProfileShape): Promise<OutboundReply> {
  await updateChatState(chatId, {
    status: ChatStatus.WAITING_MANAGER,
    mode: ChatMode.MANUAL,
    conversationState: ConversationState.HUMAN_HANDOFF_WAITING,
    currentScenarioCode: null,
    currentScenarioStep: null,
    scenarioData: null,
    failedIntentCount: 0,
    isUrgent: true,
    priority: 'high'
  });

  await prisma.chat.update({
    where: { id: chatId },
    data: { tags: { push: 'Срочно' } as never }
  }).catch(() => undefined);

  await prisma.notification.create({
    data: {
      title: 'Срочное обращение',
      body: `Чат ${chatId} отмечен как срочный`,
      type: 'urgent_chat',
      payload: { chatId }
    }
  });

  return {
    chatId,
    text: `${profile.urgentText ?? 'Понимаю, что ситуация может быть срочной.'}\n\n${getDisclaimer(profile)}\n\nЕсли вашему здоровью угрожает опасность, незамедлительно обратитесь за экстренной медицинской помощью или вызовите скорую помощь.`,
    buttons: ['Связаться с администратором', 'Позвонить в клинику', 'В меню']
  };
}

async function createAppointmentAndLead(params: {
  chatId: string;
  clientId: string;
  profile: ClinicProfileShape;
  data: ScenarioData;
  channel: Channel;
}): Promise<void> {
  const scheduledAt =
    params.data.scheduledAt instanceof Date
      ? params.data.scheduledAt
      : typeof params.data.scheduledAt === 'string'
        ? new Date(params.data.scheduledAt)
        : typeof params.data.date === 'string'
          ? new Date(params.data.date)
          : new Date(String(params.data.scheduledAt ?? ''));

  const appointment = await prisma.appointment.create({
    data: {
      clientId: params.clientId,
      chatId: params.chatId,
      service: String(params.data.specialization ?? params.data.service ?? 'Запись'),
      doctor: params.data.doctorName ? String(params.data.doctorName) : null,
      scheduledAt: Number.isNaN(scheduledAt.getTime()) ? new Date() : scheduledAt,
      status: AppointmentStatus.WAITING_CONFIRMATION,
      comment: params.data.comment ? String(params.data.comment) : null
    }
  });

  await prisma.scheduledTask.createMany({
    data: [
      {
        type: 'appointment_reminder_24h',
        runAt: new Date(appointment.scheduledAt.getTime() - 24 * 60 * 60 * 1000),
        payload: { appointmentId: appointment.id, channel: params.channel }
      },
      {
        type: 'appointment_reminder_2h',
        runAt: new Date(appointment.scheduledAt.getTime() - 2 * 60 * 60 * 1000),
        payload: { appointmentId: appointment.id, channel: params.channel }
      }
    ]
  });

  const leadChat = await prisma.chat.findUnique({ where: { id: params.chatId } });
  if (leadChat) {
    await prisma.lead.upsert({
      where: { chatId: params.chatId },
      update: {
        source: 'appointment',
        channel: params.channel as any,
        fullName: String(params.data.name ?? leadChat.clientId),
        phone: params.data.phone ? String(params.data.phone) : undefined,
        email: params.data.email ? String(params.data.email) : undefined,
        username: params.data.username ? String(params.data.username) : undefined,
        company: params.data.company ? String(params.data.company) : undefined,
        comment: params.data.comment ? String(params.data.comment) : undefined,
        interest: String(params.data.specialization ?? params.data.service ?? 'Запись'),
        status: 'CONSULTATION_SCHEDULED' as any,
        tags: { push: 'Запись' } as never
      },
      create: {
        clientId: params.clientId,
        chatId: params.chatId,
        channel: params.channel as any,
        source: 'appointment',
        fullName: String(params.data.name ?? ''),
        phone: params.data.phone ? String(params.data.phone) : null,
        email: params.data.email ? String(params.data.email) : null,
        username: params.data.username ? String(params.data.username) : null,
        company: params.data.company ? String(params.data.company) : null,
        comment: params.data.comment ? String(params.data.comment) : null,
        interest: String(params.data.specialization ?? params.data.service ?? 'Запись'),
        status: 'NEW' as any,
        tags: ['Запись']
      }
    });
  }

  await prisma.notification.create({
    data: {
      title: 'Новая запись',
      body: `Создана запись на ${String(params.data.specialization ?? params.data.service ?? 'прием')}`,
      type: 'appointment_created',
      payload: { chatId: params.chatId, appointmentId: appointment.id }
    }
  });

  await updateChatState(params.chatId, {
    status: ChatStatus.WAITING_CONFIRMATION,
    conversationState: ConversationState.MAIN_MENU,
    currentScenarioCode: null,
    currentScenarioStep: null,
    scenarioData: null,
    sourceTransition: 'appointment_confirmed',
    failedIntentCount: 0,
    priority: 'medium'
  });
}

async function handleMainMenuTrigger(chatId: string, profile: ClinicProfileShape): Promise<OutboundReply> {
  await updateChatState(chatId, {
    status: ChatStatus.BOT_IN_PROGRESS,
    conversationState: ConversationState.MAIN_MENU,
    currentScenarioCode: null,
    currentScenarioStep: null,
    scenarioData: null,
    failedIntentCount: 0,
    priority: 'medium',
    mode: ChatMode.AUTO
  });

  return {
    chatId,
    text: `${profile.welcomeText ?? 'Здравствуйте! Добро пожаловать в клинику.'}\n\n${getDisclaimer(profile)}\n\n${profile.mainMenuText ?? 'Чем я могу помочь?'}\n\nВыберите, пожалуйста, что вас интересует:`,
    buttons: getMenuButtons()
  };
}

async function handleFallback(chatId: string, profile: ClinicProfileShape, currentFails: number): Promise<OutboundReply> {
  const nextFails = currentFails + 1;
  const shouldHandOff = nextFails >= 2;

  await updateChatState(chatId, {
    failedIntentCount: nextFails,
    conversationState: shouldHandOff ? ConversationState.HUMAN_HANDOFF_WAITING : ConversationState.MAIN_MENU,
    status: shouldHandOff ? ChatStatus.WAITING_MANAGER : ChatStatus.BOT_IN_PROGRESS,
    mode: shouldHandOff ? ChatMode.MANUAL : ChatMode.AUTO,
    sourceTransition: shouldHandOff ? 'fallback_handoff' : 'fallback_retry'
  });

  if (shouldHandOff) {
    await prisma.notification.create({
      data: {
        title: 'Чат ожидает администратора',
        body: `Чат ${chatId} переведен после нескольких неуспешных попыток`,
        type: 'fallback_handoff',
        payload: { chatId }
      }
    });

    return {
      chatId,
      text: 'Я пока не смог правильно распознать запрос. Могу сразу передать его администратору.',
      buttons: ['Передать администратору', 'В меню']
    };
  }

  return {
    chatId,
    text: profile.fallbackText ?? 'Я не совсем понял ваш запрос. Пожалуйста, выберите один из вариантов ниже, и я постараюсь помочь.',
    buttons: getMenuButtons()
  };
}

async function handlePriceFlow(chat: Awaited<ReturnType<typeof prisma.chat.findUnique>> & { id: string }, profile: ClinicProfileShape, text: string): Promise<OutboundReply> {
  const data = (chat.scenarioData ?? {}) as ScenarioData;
  const service = findServiceAnswer(profile, text) ?? (data.service ? { name: String(data.service), price: 'от 0 ₽' } : null);

  if (!service && includesAny(normalizeText(text), NO_WORDS)) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.MAIN_MENU,
      currentScenarioCode: null,
      currentScenarioStep: null,
      scenarioData: null,
      failedIntentCount: 0
    });
    return handleMainMenuTrigger(chat.id, profile);
  }

  if (!service) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.PRICE_FLOW,
      currentScenarioCode: 'price_flow',
      currentScenarioStep: 'service',
      scenarioData: { ...data },
      failedIntentCount: (chat.failedIntentCount ?? 0) + 1
    });

    return {
      chatId: chat.id,
      text: 'Выберите, пожалуйста, интересующую услугу:',
      buttons: ['Прием терапевта', 'Прием кардиолога', 'Стоматология', 'Анализы', 'Другое', 'В меню']
    };
  }

  data.service = service.name;
  await updateChatState(chat.id, {
    conversationState: ConversationState.PRICE_FLOW,
    currentScenarioCode: 'price_flow',
    currentScenarioStep: 'offer_booking',
    scenarioData: data,
    failedIntentCount: 0
  });

  return {
    chatId: chat.id,
    text: `Стоимость услуги “${service.name}” — ${service.price}.\nТочную стоимость администратор сможет уточнить при необходимости.\n\nХотите записаться?`,
    buttons: ['Да, записаться', 'Связаться с администратором', 'Вернуться в меню']
  };
}

async function handleDoctorFlow(chat: Awaited<ReturnType<typeof prisma.chat.findUnique>> & { id: string }, profile: ClinicProfileShape, text: string): Promise<OutboundReply> {
  const data = (chat.scenarioData ?? {}) as ScenarioData;
  const state = String(chat.currentScenarioStep ?? 'specialization');

  if (state === 'specialization') {
    const specialization = normalizeText(text);
    if (!specialization || includesAny(specialization, NO_WORDS)) {
      await updateChatState(chat.id, {
        conversationState: ConversationState.DOCTOR_SELECTION_FLOW,
        currentScenarioCode: 'doctor_selection_flow',
        currentScenarioStep: 'specialization',
        scenarioData: data
      });
      return {
        chatId: chat.id,
        text: 'Подскажите, пожалуйста, специалист какого профиля вам нужен?',
        buttons: ['Терапевт', 'Кардиолог', 'Гинеколог', 'Стоматолог', 'Педиатр', 'Не знаю, нужен совет администратора', 'В меню']
      };
    }

    data.specialization = text.trim();
    const doctors = findDoctors(profile, text.trim());

    if (doctors.length === 0) {
      await updateChatState(chat.id, {
        conversationState: ConversationState.APPOINTMENT_FLOW,
        currentScenarioCode: 'appointment_flow',
        currentScenarioStep: 'date',
        scenarioData: data
      });
      return {
        chatId: chat.id,
        text: `По направлению “${text.trim()}” у нас пока нет списка врачей. Перейдем к записи?`,
        buttons: ['Записаться', 'Связаться с администратором', 'В меню']
      };
    }

    data.doctors = doctors;
    await updateChatState(chat.id, {
      conversationState: ConversationState.DOCTOR_SELECTION_FLOW,
      currentScenarioCode: 'doctor_selection_flow',
      currentScenarioStep: 'doctor',
      scenarioData: data
    });

    const doctorNames = doctors.slice(0, 3).map((doctor) => `${String(doctor.name ?? 'Врач')} - ${String(doctor.specialization ?? '')}`.trim());
    return {
      chatId: chat.id,
      text: 'По выбранному направлению у нас доступны следующие специалисты:\n\n' + doctorNames.join('\n'),
      buttons: [...doctorNames, 'Записаться к этому врачу', 'Выбрать другого врача', 'Связаться с администратором', 'В меню']
    };
  }

  if (state === 'doctor') {
    if (includesAny(normalizeText(text), ['в меню'])) {
      await updateChatState(chat.id, {
        conversationState: ConversationState.MAIN_MENU,
        currentScenarioCode: null,
        currentScenarioStep: null,
        scenarioData: null
      });
      return handleMainMenuTrigger(chat.id, profile);
    }

    data.doctorName = text.trim();
    await updateChatState(chat.id, {
      conversationState: ConversationState.APPOINTMENT_FLOW,
      currentScenarioCode: 'appointment_flow',
      currentScenarioStep: 'date',
      scenarioData: data
    });

    return {
      chatId: chat.id,
      text: 'Отлично. Укажите удобную дату для записи.',
      buttons: ['Сегодня', 'Завтра', 'Выбрать другую дату', 'Связаться с администратором', 'В меню']
    };
  }

  return {
    chatId: chat.id,
    text: 'Подскажите, пожалуйста, специалист какого профиля вам нужен?',
    buttons: ['Терапевт', 'Кардиолог', 'Гинеколог', 'Стоматолог', 'Педиатр', 'Не знаю, нужен совет администратора', 'В меню']
  };
}

async function handleAppointmentFlow(
  chat: Awaited<ReturnType<typeof prisma.chat.findUnique>> & { id: string; clientId: string },
  clientId: string,
  profile: ClinicProfileShape,
  text: string
): Promise<OutboundReply> {
  const data = (chat.scenarioData ?? {}) as ScenarioData;
  const state = String(chat.currentScenarioStep ?? 'specialization');
  const normalized = normalizeText(text);

  if (includesAny(normalized, NO_WORDS)) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.MAIN_MENU,
      currentScenarioCode: null,
      currentScenarioStep: null,
      scenarioData: null,
      failedIntentCount: 0
    });
    return handleMainMenuTrigger(chat.id, profile);
  }

  if (includesAny(normalized, MANAGER_WORDS)) {
    return handleHumanHandoff(chat.id, profile, 'appointment_handoff');
  }

  if (state === 'specialization') {
    if (!text.trim()) {
      return {
        chatId: chat.id,
        text: 'Пожалуйста, выберите нужное направление:',
        buttons: ['Терапевт', 'Кардиолог', 'Гинеколог', 'Стоматолог', 'Педиатр', 'Другое направление', 'Связаться с администратором']
      };
    }

    data.specialization = text.trim();
    await updateChatState(chat.id, {
      conversationState: ConversationState.APPOINTMENT_FLOW,
      currentScenarioCode: 'appointment_flow',
      currentScenarioStep: 'doctor',
      scenarioData: data,
      sourceTransition: 'specialization_selected'
    });

    const doctors = findDoctors(profile, text.trim());
    if (doctors.length > 0) {
      const doctorNames = doctors.slice(0, 3).map((doctor) => String(doctor.name ?? 'Врач'));
      return {
        chatId: chat.id,
        text: 'Выберите врача:',
        buttons: [...doctorNames, 'Не важно, любой специалист', 'В меню']
      };
    }

    await updateChatState(chat.id, {
      currentScenarioStep: 'date'
    });
    return {
      chatId: chat.id,
      text: 'Укажите удобную дату для записи.',
      buttons: ['Сегодня', 'Завтра', 'Выбрать другую дату', 'Связаться с администратором', 'В меню']
    };
  }

  if (state === 'doctor') {
    if (normalized.includes('любой') || normalized.includes('не важно')) {
      data.doctorName = null;
      await updateChatState(chat.id, {
        currentScenarioStep: 'date',
        scenarioData: data
      });
      return {
        chatId: chat.id,
        text: 'Укажите удобную дату для записи.',
        buttons: ['Сегодня', 'Завтра', 'Выбрать другую дату', 'Связаться с администратором', 'В меню']
      };
    }

    data.doctorName = text.trim();
    await updateChatState(chat.id, {
      currentScenarioStep: 'date',
      scenarioData: data
    });

    return {
      chatId: chat.id,
      text: 'Укажите удобную дату для записи.',
      buttons: ['Сегодня', 'Завтра', 'Выбрать другую дату', 'Связаться с администратором', 'В меню']
    };
  }

  if (state === 'date') {
    let selectedDate: Date | null = null;
    if (normalized === 'сегодня') {
      selectedDate = new Date();
    } else if (normalized === 'завтра') {
      selectedDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else {
      const parsed = parseDateCandidate(text);
      if (!parsed) {
        return {
          chatId: chat.id,
          text: 'Не удалось определить дату. Пожалуйста, укажите ее в формате ДД.ММ.ГГГГ.',
          buttons: ['Сегодня', 'Завтра', 'Связаться с администратором', 'В меню']
        };
      }
      if (parsed.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        return {
          chatId: chat.id,
          text: 'Дата не должна быть в прошлом. Пожалуйста, выберите ближайшую доступную дату.',
          buttons: ['Сегодня', 'Завтра', 'Связаться с администратором', 'В меню']
        };
      }
      selectedDate = parsed;
    }

    data.date = selectedDate.toISOString();
    const availableSlots = await getAvailableAppointmentSlots({
      profile,
      from: selectedDate.toISOString(),
      specialization: typeof data.specialization === 'string' ? data.specialization : undefined,
      doctorName: typeof data.doctorName === 'string' ? data.doctorName : undefined,
      limit: 6
    });
    data.availableSlots = availableSlots;

    await updateChatState(chat.id, {
      currentScenarioStep: 'time',
      scenarioData: data
    });

    return {
      chatId: chat.id,
      text: availableSlots.length
        ? 'Укажите удобное время. Вот ближайшие доступные слоты:'
        : 'Укажите удобное время. Ближайшие доступные слоты сейчас недоступны, но вы можете ввести удобное время вручную.',
      buttons: [
        ...(availableSlots.length ? availableSlots.map((slot) => slot.label) : ['Утро', 'День', 'Вечер', 'Не важно']),
        'Связаться с администратором',
        'В меню'
      ]
    };
  }

  if (state === 'time') {
    const availableSlots = Array.isArray(data.availableSlots)
      ? (data.availableSlots as Array<{ scheduledAt: string; label: string }>)
      : [];
    const pickedSlot = availableSlots.find(
      (slot) => normalizeText(slot.label) === normalizeText(text) || normalizeText(new Date(slot.scheduledAt).toISOString()) === normalizeText(text)
    );

    if (pickedSlot) {
      data.scheduledAt = pickedSlot.scheduledAt;
      data.time = new Date(pickedSlot.scheduledAt).toTimeString().slice(0, 5);
    } else if (normalized === 'не важно') {
      const fallbackSlot = availableSlots[0];
      if (fallbackSlot) {
        data.scheduledAt = fallbackSlot.scheduledAt;
        data.time = new Date(fallbackSlot.scheduledAt).toTimeString().slice(0, 5);
      } else {
        data.time = 'не важно';
      }
    } else {
      const timeMatch = normalized.match(/^(\d{1,2})[:.](\d{2})$/);
      if (timeMatch && data.date) {
        const [_, hh, mm] = timeMatch;
        const date = new Date(String(data.date));
        date.setHours(Number(hh), Number(mm), 0, 0);
        data.scheduledAt = date.toISOString();
        data.time = `${hh.padStart(2, '0')}:${mm}`;
      } else {
        data.time = text.trim();
      }
    }

    await updateChatState(chat.id, {
      currentScenarioStep: 'name',
      scenarioData: data
    });

    return {
      chatId: chat.id,
      text: 'Укажите, пожалуйста, ваше имя.',
      buttons: ['В меню']
    };
  }

  if (state === 'name') {
    if (!text.trim() || text.trim().length < 2 || /^\W+$/.test(text.trim())) {
      return {
        chatId: chat.id,
        text: 'Пожалуйста, напишите ваше имя, чтобы мы могли оформить запись.',
        buttons: ['В меню']
      };
    }

    data.name = text.trim();
    await updateChatState(chat.id, {
      currentScenarioStep: 'phone',
      scenarioData: data
    });

    return {
      chatId: chat.id,
      text: 'Оставьте, пожалуйста, номер телефона для подтверждения записи.',
      buttons: ['Поделиться телефоном', 'В меню']
    };
  }

  if (state === 'phone') {
    const phone = normalizePhone(text);
    if (!phone) {
      return {
        chatId: chat.id,
        text: 'Пожалуйста, укажите номер телефона в корректном формате. Например: +7XXXXXXXXXX',
        buttons: ['В меню']
      };
    }

    data.phone = phone;
    await updateChatState(chat.id, {
      currentScenarioStep: 'comment',
      scenarioData: data
    });

    return {
      chatId: chat.id,
      text: 'Если хотите, можете добавить комментарий к записи. Например: первичный прием, нужна справка, повторный визит. Если комментарий не нужен, напишите “Нет”.',
      buttons: ['Нет', 'Связаться с администратором', 'В меню']
    };
  }

  if (state === 'comment') {
    data.comment = includesAny(normalized, NO_WORDS) ? null : text.trim();
    await updateChatState(chat.id, {
      currentScenarioStep: 'confirm',
      scenarioData: data
    });

    return {
      chatId: chat.id,
      text:
        `Проверьте, пожалуйста, данные:\n` +
        `Направление: ${String(data.specialization ?? 'не указано')}\n` +
        `Врач: ${String(data.doctorName ?? 'любой специалист')}\n` +
        `Дата: ${String(data.date ?? 'не указана')}\n` +
        `Время: ${String(data.time ?? 'не указано')}\n` +
        `Имя: ${String(data.name ?? 'не указано')}\n` +
        `Телефон: ${String(data.phone ?? 'не указан')}\n` +
        `Комментарий: ${String(data.comment ?? 'нет')}\n\nВсе верно?`,
      buttons: ['Подтвердить', 'Изменить', 'Связаться с администратором', 'В меню']
    };
  }

  if (state === 'confirm') {
    if (includesAny(normalized, YES_WORDS) || normalized === 'подтвердить') {
      const scheduledAt = typeof data.scheduledAt === 'string' ? new Date(data.scheduledAt) : data.scheduledAt instanceof Date ? data.scheduledAt : null;
      if (scheduledAt) {
        const available = await prisma.appointment.findFirst({
          where: {
            scheduledAt,
            OR: [
              data.doctorName ? { doctor: String(data.doctorName) } : undefined,
              data.specialization ? { service: { contains: String(data.specialization), mode: 'insensitive' } } : undefined
            ].filter(Boolean) as Array<Record<string, unknown>>
          },
          select: { id: true }
        });

        if (available) {
          const slots = await getAvailableAppointmentSlots({
            profile,
            from: scheduledAt.toISOString(),
            specialization: typeof data.specialization === 'string' ? data.specialization : undefined,
            doctorName: typeof data.doctorName === 'string' ? data.doctorName : undefined,
            limit: 4
          });

          await updateChatState(chat.id, {
            currentScenarioStep: 'time',
            scenarioData: { ...data, availableSlots: slots }
          });

          return {
            chatId: chat.id,
            text: 'К сожалению, выбранный слот уже занят. Пожалуйста, выберите другой удобный вариант:',
            buttons: slots.length ? slots.map((slot) => slot.label) : ['Утро', 'День', 'Вечер', 'Связаться с администратором', 'В меню']
          };
        }
      }

      await createAppointmentAndLead({ chatId: chat.id, clientId, profile, data, channel: chat.channel as any });
      await logOutboundMessage(chat.id, 'Спасибо! Ваша заявка на запись принята. Администратор свяжется с вами для подтверждения.');
      await updateChatState(chat.id, {
        status: ChatStatus.WAITING_CONFIRMATION,
        conversationState: ConversationState.MAIN_MENU,
        currentScenarioCode: null,
        currentScenarioStep: null,
        scenarioData: null,
        failedIntentCount: 0,
        sourceTransition: 'appointment_completed'
      });

      return {
        chatId: chat.id,
        text: 'Спасибо! Ваша заявка на запись принята.\nАдминистратор свяжется с вами для подтверждения.\n\nЕсли хотите, я могу помочь еще с чем-то.',
        buttons: ['Вернуться в меню', 'Связаться с администратором']
      };
    }

    if (includesAny(normalized, NO_WORDS) || normalized.includes('измен')) {
      await updateChatState(chat.id, {
        currentScenarioStep: 'specialization'
      });
      return {
        chatId: chat.id,
        text: 'Пожалуйста, выберите нужное направление:',
        buttons: ['Терапевт', 'Кардиолог', 'Гинеколог', 'Стоматолог', 'Педиатр', 'Другое направление', 'Связаться с администратором']
      };
    }

    return handleHumanHandoff(chat.id, profile, 'appointment_confirm_handoff');
  }

  return {
    chatId: chat.id,
    text: 'Пожалуйста, выберите нужное направление:',
    buttons: ['Терапевт', 'Кардиолог', 'Гинеколог', 'Стоматолог', 'Педиатр', 'Другое направление', 'Связаться с администратором']
  };
}

async function handleContactCollectionFlow(
  chat: Awaited<ReturnType<typeof prisma.chat.findUnique>> & { id: string; clientId: string },
  clientId: string,
  profile: ClinicProfileShape,
  text: string
): Promise<OutboundReply> {
  const data = (chat.scenarioData ?? {}) as ScenarioData;
  const normalized = normalizeText(text);

  if (String(chat.currentScenarioStep ?? 'phone') === 'phone') {
    const phone = normalizePhone(text);
    if (!phone) {
      return {
        chatId: chat.id,
        text: 'Пожалуйста, укажите номер телефона в корректном формате. Например: +7XXXXXXXXXX',
        buttons: ['В меню']
      };
    }

    data.phone = phone;
    await updateChatState(chat.id, {
      currentScenarioStep: 'question',
      scenarioData: data,
      conversationState: ConversationState.CONTACT_COLLECTION_FLOW
    });

    return {
      chatId: chat.id,
      text: 'Спасибо! Если хотите, напишите коротко, по какому вопросу вам удобнее перезвонить.',
      buttons: ['Нет', 'В меню']
    };
  }

  data.comment = includesAny(normalized, NO_WORDS) ? null : text.trim();

  await prisma.lead.create({
    data: {
      clientId,
      chatId: chat.id,
      channel: chat.channel,
      source: 'contact_collection',
      fullName: data.name ? String(data.name) : null,
      phone: data.phone ? String(data.phone) : null,
      email: data.email ? String(data.email) : null,
      username: data.username ? String(data.username) : null,
      comment: data.comment ? String(data.comment) : null,
      interest: String(data.topic ?? 'Обратная связь'),
      status: 'NEW',
      tags: ['Контакты']
    }
  });

  await updateChatState(chat.id, {
    conversationState: ConversationState.MAIN_MENU,
    currentScenarioCode: null,
    currentScenarioStep: null,
    scenarioData: null,
    failedIntentCount: 0
  });

  await prisma.notification.create({
    data: {
      title: 'Новый контакт',
      body: `Получен контакт от клиента по чату ${chat.id}`,
      type: 'contact_lead',
      payload: { chatId: chat.id }
    }
  });

  return {
    chatId: chat.id,
    text: 'Спасибо, мы передали ваш запрос администратору.',
    buttons: ['Вернуться в меню', 'Связаться с администратором']
  };
}

async function handleInfoFlow(chatId: string, profile: ClinicProfileShape): Promise<OutboundReply> {
  await updateChatState(chatId, {
    conversationState: ConversationState.MAIN_MENU,
    currentScenarioCode: null,
    currentScenarioStep: null,
    scenarioData: null,
    failedIntentCount: 0
  });

  return {
    chatId,
    text: `${getClinicInfo(profile)}\n\nЧто вас интересует дальше?`,
    buttons: ['Записаться на прием', 'Связаться с администратором', 'Вернуться в меню']
  };
}

async function handleFaq(text: string, chatId: string, _profile: ClinicProfileShape): Promise<OutboundReply | null> {
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

  if (!faq) return null;

  await prisma.faqItem.update({ where: { id: faq.id }, data: { usageCount: { increment: 1 } } });

  await updateChatState(chatId, {
    conversationState: ConversationState.FAQ_FLOW,
    currentScenarioCode: 'faq_flow',
    currentScenarioStep: 'answer',
    failedIntentCount: 0
  });

  return {
    chatId,
    text: `Вот что я нашел по вашему вопросу:\n${faq.answer}\n\nХотите еще что-то уточнить?`,
    buttons: ['Записаться на прием', 'Связаться с администратором', 'В меню']
  };
}

async function routeByIntent(params: {
  chat: Awaited<ReturnType<typeof prisma.chat.findUnique>> & { id: string; clientId: string };
  clientId: string;
  profile: ClinicProfileShape;
  text: string;
}): Promise<OutboundReply | null> {
  const { chat, profile, text } = params;
  const normalized = normalizeText(text);

  if (includesAny(normalized, URGENT_WORDS)) {
    return handleUrgent(chat.id, profile);
  }

  if (includesAny(normalized, MANAGER_WORDS)) {
    return handleHumanHandoff(chat.id, profile, 'manager_request');
  }

  if (includesAny(normalized, BOOKING_WORDS)) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.APPOINTMENT_FLOW,
      currentScenarioCode: 'appointment_flow',
      currentScenarioStep: 'specialization',
      scenarioData: {},
      sourceTransition: 'booking_intent',
      failedIntentCount: 0,
      status: ChatStatus.APPOINTMENT
    });
    return {
      chatId: chat.id,
      text: 'Пожалуйста, выберите нужное направление:',
      buttons: ['Терапевт', 'Кардиолог', 'Гинеколог', 'Стоматолог', 'Педиатр', 'Другое направление', 'Связаться с администратором']
    };
  }

  if (includesAny(normalized, PRICE_WORDS)) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.PRICE_FLOW,
      currentScenarioCode: 'price_flow',
      currentScenarioStep: 'service',
      scenarioData: { service: null },
      sourceTransition: 'price_intent',
      failedIntentCount: 0
    });
    return {
      chatId: chat.id,
      text: 'Выберите, пожалуйста, интересующую услугу:',
      buttons: ['Прием терапевта', 'Прием кардиолога', 'Стоматология', 'Анализы', 'Другое', 'В меню']
    };
  }

  if (includesAny(normalized, DOCTOR_WORDS)) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.DOCTOR_SELECTION_FLOW,
      currentScenarioCode: 'doctor_selection_flow',
      currentScenarioStep: 'specialization',
      scenarioData: {},
      sourceTransition: 'doctor_intent',
      failedIntentCount: 0
    });
    return {
      chatId: chat.id,
      text: 'Подскажите, пожалуйста, специалист какого профиля вам нужен?',
      buttons: ['Терапевт', 'Кардиолог', 'Гинеколог', 'Стоматолог', 'Педиатр', 'Не знаю, нужен совет администратора', 'В меню']
    };
  }

  if (includesAny(normalized, CLINIC_INFO_WORDS)) {
    return handleInfoFlow(chat.id, profile);
  }

  if (includesAny(normalized, CONTACT_WORDS)) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.CONTACT_COLLECTION_FLOW,
      currentScenarioCode: 'contact_collection_flow',
      currentScenarioStep: 'phone',
      scenarioData: {},
      sourceTransition: 'contact_intent',
      failedIntentCount: 0
    });
    return {
      chatId: chat.id,
      text: 'Чтобы администратор мог с вами связаться, оставьте, пожалуйста, номер телефона.',
      buttons: ['Поделиться телефоном', 'В меню']
    };
  }

  const faqReply = await handleFaq(text, chat.id, profile);
  if (faqReply) return faqReply;

  if (!isWorkingNow(profile) && !includesAny(normalized, MANAGER_WORDS) && !includesAny(normalized, URGENT_WORDS)) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.MAIN_MENU,
      currentScenarioCode: null,
      currentScenarioStep: null,
      scenarioData: null,
      sourceTransition: 'after_hours',
      failedIntentCount: 0
    });

    return {
      chatId: chat.id,
      text:
        `${profile.afterHoursText ?? 'Вы обратились вне рабочего времени клиники.'}\n` +
        `\nПока вы можете:\n` +
        `- записаться на прием\n` +
        `- оставить номер телефона\n` +
        `- узнать основную информацию о клинике`,
      buttons: ['Записаться на прием', 'Оставить номер телефона', 'График и адрес', 'В меню']
    };
  }

  return null;
}

async function routeActiveFlow(params: {
  chat: Awaited<ReturnType<typeof prisma.chat.findUnique>> & { id: string; clientId: string };
  clientId: string;
  profile: ClinicProfileShape;
  text: string;
}): Promise<OutboundReply | null> {
  const { chat, clientId, profile, text } = params;

  switch (chat.conversationState) {
    case ConversationState.APPOINTMENT_FLOW:
      return handleAppointmentFlow(chat, clientId, profile, text);
    case ConversationState.DOCTOR_SELECTION_FLOW:
      return handleDoctorFlow(chat, profile, text);
    case ConversationState.PRICE_FLOW:
      return handlePriceFlow(chat, profile, text);
    case ConversationState.CONTACT_COLLECTION_FLOW:
      return handleContactCollectionFlow(chat, clientId, profile, text);
    case ConversationState.HUMAN_HANDOFF_WAITING:
    case ConversationState.HUMAN_MODE:
      await prisma.message.create({
        data: {
          chatId: chat.id,
          text,
          direction: MessageDirection.INBOUND as any,
          senderClientId: clientId
        }
      });
      return null;
    case ConversationState.CLOSED:
      return {
        chatId: chat.id,
        text: 'Спасибо за обращение! Если вам понадобится помощь, просто напишите снова.',
        buttons: ['В меню']
      };
    default:
      return null;
  }
}

export async function processInboundMessage(payload: InboundPayload): Promise<OutboundReply | null> {
  const profile = await getClinicProfile();
  const { client, chat } = await ensureActiveChat(payload);
  const text = payload.text.trim();
  const normalized = normalizeText(text);

  await storeInboundMessage(chat.id, client.id, text, payload.raw);

  if (includesAny(normalized, ['/start', '/menu', '/help']) || normalized === 'в меню' || chat.conversationState === ConversationState.NEW) {
    const menuReply = await handleMainMenuTrigger(chat.id, profile);
    await logOutboundMessage(chat.id, menuReply.text);
    await updateChatState(chat.id, { lastBotMessageAt: new Date() });
    publishLiveEvent({ type: 'workspace:update', chatId: chat.id, entity: 'chat', timestamp: new Date().toISOString() });
    return menuReply;
  }

  if (chat.mode === ChatMode.CLOSED) {
    return {
      chatId: chat.id,
      text: 'Спасибо за обращение! Если вам понадобится помощь, просто напишите снова.',
      buttons: ['В меню']
    };
  }

  if (chat.mode === ChatMode.MANUAL && chat.conversationState !== ConversationState.HUMAN_MODE) {
    await updateChatState(chat.id, {
      conversationState: ConversationState.HUMAN_HANDOFF_WAITING,
      status: ChatStatus.WAITING_MANAGER
    });
    return null;
  }

  const activeFlowReply = await routeActiveFlow({ chat, clientId: client.id, profile, text });
  if (activeFlowReply) {
    await logOutboundMessage(chat.id, activeFlowReply.text);
    await updateChatState(chat.id, { lastBotMessageAt: new Date() });
    publishLiveEvent({ type: 'workspace:update', chatId: chat.id, entity: 'chat', timestamp: new Date().toISOString() });
    return activeFlowReply;
  }

  const intentReply = await routeByIntent({ chat, clientId: client.id, profile, text });
  if (intentReply) {
    await logOutboundMessage(chat.id, intentReply.text);
    await updateChatState(chat.id, { lastBotMessageAt: new Date() });
    publishLiveEvent({ type: 'workspace:update', chatId: chat.id, entity: 'chat', timestamp: new Date().toISOString() });
    return intentReply;
  }

  const fallbackReply = await handleFallback(chat.id, profile, chat.failedIntentCount ?? 0);
  await logOutboundMessage(chat.id, fallbackReply.text);
  await updateChatState(chat.id, { lastBotMessageAt: new Date() });
  publishLiveEvent({ type: 'workspace:update', chatId: chat.id, entity: 'chat', timestamp: new Date().toISOString() });
  return fallbackReply;
}
