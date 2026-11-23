import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

const openApiPath = path.resolve(process.cwd(), 'docs/openapi.yaml');

function loadSpec(): Record<string, unknown> {
  return YAML.parse(readFileSync(openApiPath, 'utf8')) as Record<string, unknown>;
}

export const docsRouter = Router();

docsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').sendFile(openApiPath);
});

// The spec is read once at boot; restart the API after editing docs/openapi.yaml.
const spec = loadSpec();

docsRouter.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: 'Sarvodaya API docs',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
  }),
);
