import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type AccessPayload = {
  sub: string;
  role: string;
  permissions: string[];
};

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.accessSecret, { expiresIn: env.accessTtl });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.refreshSecret, { expiresIn: env.refreshTtl });
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, env.accessSecret) as AccessPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.refreshSecret) as { sub: string };
}
