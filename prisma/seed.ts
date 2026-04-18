import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PERMISSIONS = [
  'users.read',
  'users.write',
  'roles.read',
  'roles.write',
  'clients.read',
  'clients.write',
  'chats.read',
  'chats.write',
  'messages.send',
  'leads.read',
  'leads.write',
  'faq.read',
  'faq.write',
  'quiz.read',
  'quiz.write',
  'scenarios.read',
  'scenarios.write',
  'appointments.read',
  'appointments.write',
  'settings.read',
  'settings.write',
  'notifications.read',
  'notifications.write',
  'events.read',
  'analytics.read',
  'integrations.read',
  'integrations.write',
  'audit.read'
];

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  superadmin: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => !p.startsWith('integrations.write')),
  head_support: [
    'users.read',
    'clients.read',
    'clients.write',
    'chats.read',
    'chats.write',
    'messages.send',
    'leads.read',
    'leads.write',
    'appointments.read',
    'appointments.write',
    'settings.read',
    'settings.write',
    'analytics.read'
  ],
  operator: [
    'clients.read',
    'clients.write',
    'chats.read',
    'chats.write',
    'messages.send',
    'leads.read',
    'leads.write',
    'appointments.read',
    'notifications.read'
  ],
  content_manager: ['faq.read', 'faq.write', 'quiz.read', 'quiz.write', 'scenarios.read', 'scenarios.write'],
  analyst: ['analytics.read', 'audit.read', 'events.read', 'chats.read', 'leads.read']
};

async function main() {
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code }
    });
  }

  const permissions = await prisma.permission.findMany();
  const permByCode = new Map(permissions.map((p) => [p.code, p.id]));

  for (const [roleName, codes] of Object.entries(ROLE_PERMISSION_MAP)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: roleName }
    });

    for (const code of codes) {
      const permissionId = permByCode.get(code);
      if (!permissionId) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId
        }
      });
    }
  }

  const superadminRole = await prisma.role.findUnique({ where: { name: 'superadmin' } });
  if (!superadminRole) return;

  const passwordHash = await bcrypt.hash('admin12345', 10);
  await prisma.user.upsert({
    where: { email: 'admin@local.dev' },
    update: {},
    create: {
      email: 'admin@local.dev',
      name: 'System Admin',
      passwordHash,
      roleId: superadminRole.id
    }
  });

  await prisma.clinicProfile.upsert({
    where: { id: 'default-clinic-profile' },
    update: {},
    create: {
      id: 'default-clinic-profile',
      name: 'Клиника',
      address: 'Не задано',
      phone: '+7 (000) 000-00-00',
      site: 'https://example.com',
      welcomeText: 'Здравствуйте! Добро пожаловать в клинику.',
      mainMenuText: 'Чем я могу помочь?',
      fallbackText: 'Я не совсем понял запрос. Выберите, пожалуйста, один из вариантов меню.',
      afterHoursText: 'Вы обратились вне рабочего времени клиники.',
      urgentText: 'Понимаю, что ситуация может быть срочной. Рекомендуем немедленно обратиться за экстренной помощью.',
      handoffText: 'Я передал ваш запрос администратору. Пожалуйста, ожидайте ответа.',
      disclaimerText: 'Информация, предоставляемая ботом, носит справочный характер и не заменяет консультацию врача.',
      triggerWords: ['срочно', 'сильная боль', 'кровь', 'плохо', 'экстренно'],
      workingHours: {
        mon: '09:00-18:00',
        tue: '09:00-18:00',
        wed: '09:00-18:00',
        thu: '09:00-18:00',
        fri: '09:00-18:00',
        sat: '09:00-15:00',
        sun: 'closed'
      },
      appointmentButtons: ['Записаться на прием', 'Узнать стоимость', 'Выбрать врача', 'График и адрес', 'Связаться с администратором'],
      doctors: [
        { id: 'd1', name: 'Иванов И.И.', specialization: 'Терапевт', experience: '10 лет' },
        { id: 'd2', name: 'Петрова А.С.', specialization: 'Гинеколог', experience: '8 лет' }
      ],
      services: [
        { name: 'Прием терапевта', price: 'от 1500 ₽' },
        { name: 'Прием кардиолога', price: 'от 2500 ₽' },
        { name: 'Стоматология', price: 'от 3000 ₽' },
        { name: 'Анализы', price: 'от 500 ₽' }
      ]
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
