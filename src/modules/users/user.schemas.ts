import { z } from 'zod';
import { AccountType } from '@prisma/client';
import { normalizePhone } from '../../lib/phone';

export const GST_NUMBER_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const optionalPhone = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    try {
      return normalizePhone(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10 digit mobile number' });
      return z.NEVER;
    }
  });

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Pincode must be exactly 6 digits');

export const latitudeSchema = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

export const longitudeSchema = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

/** Empty strings from HTML forms are normalised to null so they clear the field. */
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === '' ? null : value));

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120).optional(),
  companyName: optionalText(160),
  gstNumber: z
    .union([
      z
        .string()
        .trim()
        .transform((value) => value.toUpperCase())
        .refine((value) => value === '' || GST_NUMBER_REGEX.test(value), {
          message: 'GST number format looks invalid (example: 27ABCDE1234F1Z5)',
        }),
      z.null(),
    ])
    .optional()
    .transform((value) => (value === '' ? null : value)),
  /** Read-only: sending a different value is rejected so the account type cannot be changed. */
  accountType: z.nativeEnum(AccountType).optional(),
});

export const addressBodySchema = {
  label: optionalText(40),
  contactName: z.string().trim().min(2, 'Contact name is required').max(120),
  contactPhone: optionalPhone,
  line1: z.string().trim().min(3, 'Address line 1 is required').max(200),
  line2: optionalText(200),
  landmark: optionalText(160),
  city: z.string().trim().min(2, 'City is required').max(80),
  state: z.string().trim().min(2, 'State is required').max(80),
  pincode: pincodeSchema,
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
};

const latLngPaired = (value: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean => {
  const hasLat = value.latitude !== undefined && value.latitude !== null;
  const hasLng = value.longitude !== undefined && value.longitude !== null;
  return hasLat === hasLng;
};

const latLngPairingIssue = {
  message: 'latitude and longitude must be provided together',
  path: ['latitude'] as (string | number)[],
};

export const createAddressSchema = z
  .object(addressBodySchema)
  .refine(latLngPaired, latLngPairingIssue);

export const updateAddressSchema = z.object({
  ...addressBodySchema,
  contactName: addressBodySchema.contactName.optional(),
  contactPhone: addressBodySchema.contactPhone.optional(),
  line1: addressBodySchema.line1.optional(),
  city: addressBodySchema.city.optional(),
  state: addressBodySchema.state.optional(),
  pincode: pincodeSchema.optional(),
}).refine(latLngPaired, latLngPairingIssue);

export const projectSiteBodySchema = {
  siteName: z.string().trim().min(2, 'Site name is required').max(120),
  contactName: optionalText(120),
  contactPhone: optionalPhone.optional(),
  line1: z.string().trim().min(3, 'Address line 1 is required').max(200),
  line2: optionalText(200),
  landmark: optionalText(160),
  city: z.string().trim().min(2, 'City is required').max(80),
  state: z.string().trim().min(2, 'State is required').max(80),
  pincode: pincodeSchema,
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  notes: optionalText(500),
};

export const createProjectSiteSchema = z
  .object(projectSiteBodySchema)
  .refine(latLngPaired, latLngPairingIssue);

export const updateProjectSiteSchema = z.object({
  ...projectSiteBodySchema,
  siteName: projectSiteBodySchema.siteName.optional(),
  line1: projectSiteBodySchema.line1.optional(),
  city: projectSiteBodySchema.city.optional(),
  state: projectSiteBodySchema.state.optional(),
  pincode: pincodeSchema.optional(),
}).refine(latLngPaired, latLngPairingIssue);

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid id'),
});
