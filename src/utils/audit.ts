import { Request } from 'express';
import { prisma } from '../db/prisma';

type Params = {
  req?: Request;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  payload?: unknown;
};

export async function writeAuditLog(params: Params): Promise<void> {
  const { req, userId, action, entity, entityId, payload } = params;

  await prisma.auditLog.create({
    data: {
      userId: userId ?? req?.auth?.userId,
      action,
      entity,
      entityId,
      payload: payload as object | undefined,
      ip: req?.ip,
      userAgent: req?.headers['user-agent']
    }
  });
}
