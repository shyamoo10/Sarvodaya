import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import type { AccountType } from '@prisma/client';

export type AccessTokenPayload = JwtPayload & {
  sub: string;
  phone: string;
  accountType: AccountType;
};

export function signAccessToken(user: {
  id: string;
  phone: string;
  accountType: AccountType;
}): string {
  return jwt.sign(
    { phone: user.phone, accountType: user.accountType },
    env.jwtSecret,
    { subject: user.id, expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret);
  if (typeof payload === 'string' || !payload.sub) {
    throw new Error('Malformed token');
  }
  return payload as AccessTokenPayload;
}
