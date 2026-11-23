import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';
import { addressesRouter } from './modules/users/addresses.routes';
import { projectSitesRouter } from './modules/users/project-sites.routes';
import { adminRouter } from './modules/admin/admin.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/me/addresses', addressesRouter);
apiRouter.use('/me/project-sites', projectSitesRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/admin', adminRouter);
