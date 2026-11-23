import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { asyncHandler, sendSuccess, sendNoContent, ApiError } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { ErrorCode } from '../../config/error-codes';
import {
  createProjectSiteSchema,
  updateProjectSiteSchema,
  idParamSchema,
} from './user.schemas';
import { serializeProjectSite } from './user.serializer';

export const projectSitesRouter = Router();

projectSitesRouter.use(requireAuth);

type SiteBody = {
  siteName: string;
  contactName?: string | null;
  contactPhone?: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
};

async function findOwnedSite(userId: string, id: string) {
  const site = await prisma.projectSite.findFirst({ where: { id, userId } });
  if (!site) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Project site not found');
  }
  return site;
}

projectSitesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const sites = await prisma.projectSite.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, sites.map(serializeProjectSite), 200);
  }),
);

projectSitesRouter.post(
  '/',
  validate(createProjectSiteSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as SiteBody;
    const site = await prisma.projectSite.create({
      data: {
        userId: req.authUser!.id,
        siteName: body.siteName,
        contactName: body.contactName ?? null,
        contactPhone: body.contactPhone ?? null,
        line1: body.line1,
        line2: body.line2 ?? null,
        landmark: body.landmark ?? null,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        notes: body.notes ?? null,
      },
    });
    sendSuccess(res, serializeProjectSite(site), 201);
  }),
);

projectSitesRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const site = await findOwnedSite(req.authUser!.id, req.params.id as string);
    sendSuccess(res, serializeProjectSite(site), 200);
  }),
);

projectSitesRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateProjectSiteSchema),
  asyncHandler(async (req, res) => {
    const existing = await findOwnedSite(req.authUser!.id, req.params.id as string);
    const body = req.body as Partial<SiteBody>;

    const data: Prisma.ProjectSiteUpdateInput = {};
    if (body.siteName !== undefined) data.siteName = body.siteName;
    if (body.contactName !== undefined) data.contactName = body.contactName;
    if (body.contactPhone !== undefined) data.contactPhone = body.contactPhone;
    if (body.line1 !== undefined) data.line1 = body.line1;
    if (body.line2 !== undefined) data.line2 = body.line2;
    if (body.landmark !== undefined) data.landmark = body.landmark;
    if (body.city !== undefined) data.city = body.city;
    if (body.state !== undefined) data.state = body.state;
    if (body.pincode !== undefined) data.pincode = body.pincode;
    if (body.latitude !== undefined) data.latitude = body.latitude;
    if (body.longitude !== undefined) data.longitude = body.longitude;
    if (body.notes !== undefined) data.notes = body.notes;

    const site = await prisma.projectSite.update({ where: { id: existing.id }, data });
    sendSuccess(res, serializeProjectSite(site), 200);
  }),
);

projectSitesRouter.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const existing = await findOwnedSite(req.authUser!.id, req.params.id as string);
    await prisma.projectSite.delete({ where: { id: existing.id } });
    sendNoContent(res);
  }),
);
