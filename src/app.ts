import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requestId } from './middleware/request-id';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiRouter } from './routes';
import { docsRouter } from './docs/docs.router';

export function buildCorsOptions(): CorsOptions {
  const allowAll = env.corsOrigins.includes('*');
  return {
    origin(origin, callback) {
      // Same-origin and server-to-server requests have no Origin header.
      if (!origin || allowAll || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  };
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  // Swagger UI relies on inline scripts, so CSP is disabled for the docs page.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(buildCorsOptions()));
  // The raw body is kept for webhook signature checks: a Razorpay webhook is
  // signed over the exact bytes received, not over the parsed object.
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buffer) => {
        (req as typeof req & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({ success: true, data: { status: 'ok', uptimeSeconds: Math.round(process.uptime()) } });
  });

  app.use('/docs', docsRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
