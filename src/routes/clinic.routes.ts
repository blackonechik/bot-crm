import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middlewares/auth';
import { requirePermission } from '../middlewares/rbac';

const router = Router();
router.use(requireAuth);

router.get('/profile', requirePermission('settings.read'), async (_req, res, next) => {
  try {
    const profile =
      (await prisma.clinicProfile.findFirst()) ??
      (await prisma.clinicProfile.create({
        data: {
          name: 'Клиника'
        }
      }));

    res.json(profile);
  } catch (e) {
    next(e);
  }
});

router.put('/profile', requirePermission('settings.write'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      address: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      site: z.string().nullable().optional(),
      workingHours: z.unknown().optional(),
      welcomeText: z.string().nullable().optional(),
      mainMenuText: z.string().nullable().optional(),
      fallbackText: z.string().nullable().optional(),
      afterHoursText: z.string().nullable().optional(),
      urgentText: z.string().nullable().optional(),
      handoffText: z.string().nullable().optional(),
      disclaimerText: z.string().nullable().optional(),
      appointmentButtons: z.unknown().optional(),
      doctors: z.unknown().optional(),
      services: z.unknown().optional(),
      triggerWords: z.unknown().optional()
    });

    const data = schema.parse(req.body);
    const jsonOrUndefined = (value: unknown) =>
      value === undefined ? undefined : value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
    const existing = await prisma.clinicProfile.findFirst();
    const profile = existing
      ? await prisma.clinicProfile.update({
          where: { id: existing.id },
          data: {
            ...data,
            workingHours: jsonOrUndefined(data.workingHours),
            appointmentButtons: jsonOrUndefined(data.appointmentButtons),
            doctors: jsonOrUndefined(data.doctors),
            services: jsonOrUndefined(data.services),
            triggerWords: jsonOrUndefined(data.triggerWords)
          }
        })
      : await prisma.clinicProfile.create({
          data: {
            ...data,
            workingHours: jsonOrUndefined(data.workingHours),
            appointmentButtons: jsonOrUndefined(data.appointmentButtons),
            doctors: jsonOrUndefined(data.doctors),
            services: jsonOrUndefined(data.services),
            triggerWords: jsonOrUndefined(data.triggerWords)
          }
        });

    res.json(profile);
  } catch (e) {
    next(e);
  }
});

export default router;
