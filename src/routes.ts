import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';
import { addressesRouter } from './modules/users/addresses.routes';
import { projectSitesRouter } from './modules/users/project-sites.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { adminCatalogRouter } from './modules/catalog/admin-catalog.routes';
import { categoriesRouter, productsRouter } from './modules/catalog/catalog.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/me/addresses', addressesRouter);
apiRouter.use('/me/project-sites', projectSitesRouter);
apiRouter.use('/me', meRouter);
// Catalogue admin routes are mounted before the user admin router so /admin/products
// and /admin/categories are handled here (the user router answers everything else).
apiRouter.use('/admin', adminCatalogRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/products', productsRouter);
