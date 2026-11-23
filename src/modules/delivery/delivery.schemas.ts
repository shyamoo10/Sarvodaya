import { z } from 'zod';

const paise = z.number().int('Must be a whole number of paise').min(0).max(100_000_000);

export const createSlabSchema = z
  .object({
    fromKm: z.number().min(0).max(500),
    toKm: z.number().min(0).max(500).nullable(),
    chargePaise: paise,
    isActive: z.boolean().default(true),
  })
  .refine((value) => value.toKm === null || value.toKm > value.fromKm, {
    message: 'The end of the slab must be greater than its start',
    path: ['toKm'],
  });

export const updateSlabSchema = z
  .object({
    fromKm: z.number().min(0).max(500),
    toKm: z.number().min(0).max(500).nullable(),
    chargePaise: paise,
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change',
  });

export const createPincodeSchema = z.object({
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a 6 digit Indian pincode'),
  areaName: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isActive: z.boolean().default(true),
});

export const updatePincodeSchema = z
  .object({
    areaName: z.string().trim().max(120).nullable(),
    city: z.string().trim().max(80).nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change',
  });

export const pincodeQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSlabInput = z.infer<typeof createSlabSchema>;
export type UpdateSlabInput = z.infer<typeof updateSlabSchema>;
export type CreatePincodeInput = z.infer<typeof createPincodeSchema>;
export type UpdatePincodeInput = z.infer<typeof updatePincodeSchema>;
export type PincodeQuery = z.infer<typeof pincodeQuerySchema>;
