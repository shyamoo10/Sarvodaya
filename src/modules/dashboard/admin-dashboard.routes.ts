import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { dashboardQuerySchema, type DashboardQuery } from './dashboard.schemas';
import { getAdminDashboard } from './dashboard.service';

export const adminDashboardRouter = Router();

adminDashboardRouter.use(requireAuth, requireAdmin);

/** Today's orders, what is still to be delivered, low stock and COD outstanding. */
adminDashboardRouter.get(
  '/',
  validate(dashboardQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as DashboardQuery;
    sendSuccess(res, await getAdminDashboard(query), 200);
  }),
);
