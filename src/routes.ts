import { Router } from 'express';
import { requireAdmin, requireAuth } from './middleware/auth';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';
import { addressesRouter } from './modules/users/addresses.routes';
import { projectSitesRouter } from './modules/users/project-sites.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { adminCatalogRouter } from './modules/catalog/admin-catalog.routes';
import { categoriesRouter, productsRouter } from './modules/catalog/catalog.routes';
import { cartRouter } from './modules/cart/cart.routes';
import { adminPricingRouter } from './modules/pricing/admin-pricing.routes';
import { adminDeliveryRouter } from './modules/delivery/admin-delivery.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { adminOrdersRouter } from './modules/orders/admin-orders.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { adminCreditRouter } from './modules/credit/admin-credit.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { adminNotificationsRouter } from './modules/notifications/admin-notifications.routes';
import { adminDashboardRouter } from './modules/dashboard/admin-dashboard.routes';
import { adminAuditRouter } from './modules/audit/admin-audit.routes';
import { adminReportsRouter } from './modules/reports/admin-reports.routes';
import { adminDirectoryRouter } from './modules/admin/admin-directory.routes';
import { auditAdmin } from './modules/audit/audit.middleware';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/me/addresses', addressesRouter);
apiRouter.use('/me/project-sites', projectSitesRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/me/notifications', notificationsRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/payments', paymentsRouter);
// One audit hook for the whole admin surface: every successful write below is
// recorded with the admin, the action, the record and the request body.
apiRouter.use('/admin', requireAuth, requireAdmin, auditAdmin());
// Admin routers are mounted before the user admin router so their own paths
// (/admin/products, /admin/pricing/..., /admin/delivery/...) are handled here.
apiRouter.use('/admin', adminCatalogRouter);
apiRouter.use('/admin/pricing', adminPricingRouter);
apiRouter.use('/admin/delivery', adminDeliveryRouter);
apiRouter.use('/admin/orders', adminOrdersRouter);
apiRouter.use('/admin/credit-terms', adminCreditRouter);
apiRouter.use('/admin/dashboard', adminDashboardRouter);
apiRouter.use('/admin/notifications', adminNotificationsRouter);
apiRouter.use('/admin/audit-logs', adminAuditRouter);
apiRouter.use('/admin/reports', adminReportsRouter);
apiRouter.use('/admin', adminDirectoryRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/products', productsRouter);
