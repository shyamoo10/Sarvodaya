import { Router } from 'express';
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

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/me/addresses', addressesRouter);
apiRouter.use('/me/project-sites', projectSitesRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/cart', cartRouter);
// Admin routers are mounted before the user admin router so their own paths
// (/admin/products, /admin/pricing/..., /admin/delivery/...) are handled here.
apiRouter.use('/admin', adminCatalogRouter);
apiRouter.use('/admin/pricing', adminPricingRouter);
apiRouter.use('/admin/delivery', adminDeliveryRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/products', productsRouter);
