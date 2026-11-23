import { AccountType } from '@prisma/client';
import { z } from 'zod';
import { normalizePhone } from '../../lib/phone';

export const phoneSchema = z
  .string({ required_error: 'Phone number is required' })
  .trim()
  .min(1, 'Phone number is required')
  .transform((value, ctx) => {
    try {
      return normalizePhone(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid 10 digit Indian mobile number',
      });
      return z.NEVER;
    }
  });

export const accountTypeSchema = z.nativeEnum(AccountType, {
  errorMap: () => ({ message: 'accountType must be CUSTOMER, CONTRACTOR or ADMIN' }),
});

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  /** Hint only. For a new account the type is confirmed during verify. */
  accountType: accountTypeSchema.optional(),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z
    .string({ required_error: 'Otp is required' })
    .trim()
    .regex(/^\d{6}$/, 'Otp must be exactly 6 digits'),
  /** Required only when the phone number is not registered yet. */
  accountType: accountTypeSchema.optional(),
  /** Required only when the phone number is not registered yet. */
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120).optional(),
  companyName: z.string().trim().max(160).optional(),
  gstNumber: z.string().trim().max(15).optional(),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
