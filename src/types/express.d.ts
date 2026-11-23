import type { AccountType } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      authUser?: {
        id: string;
        phone: string;
        accountType: AccountType;
      };
    }
  }
}

export {};
