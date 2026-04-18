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
    'analytics.read'
  ],
  operator: [
    'clients.read',
    'clients.write',
    'chats.read',
    'chats.write',
    'messages.send',
    'leads.read',
    'leads.write'
  ],
  content_manager: ['faq.read', 'faq.write', 'quiz.read', 'quiz.write'],
  analyst: ['analytics.read', 'audit.read', 'chats.read', 'leads.read']
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
