import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

const docsDir = path.resolve(process.cwd(), 'docs');
const openApiPath = path.join(docsDir, 'openapi.yaml');

type PathsPart = { paths?: Record<string, unknown> };
type SchemasPart = { schemas?: Record<string, unknown> };

function readYaml<T>(file: string): T {
  return YAML.parse(readFileSync(file, 'utf8')) as T;
}

/**
 * The contract is split so every file stays small to review and to edit:
 *
 *  - `openapi.yaml`            info, servers, tags and shared components
 *  - `api.paths.yaml`          Step 1 paths (auth, profile, addresses, sites, admin users)
 *  - `catalogue.paths.yaml`    Step 2 catalogue paths
 *  - `step3.paths.yaml`        Step 3 cart paths
 *  - `pricing.paths.yaml`      Step 3 admin pricing paths
 *  - `delivery.paths.yaml`     Step 3 admin delivery paths
 *  - `step4.paths.yaml`        Step 4 order and payment paths
 *  - `admin-orders.paths.yaml` Step 4 admin order and credit paths
 *  - `step5.paths.yaml`        Step 5 dashboard, notifications, invoices, reports and audit
 *  - `schemas.openapi.yaml`    Step 1 and 2 component schemas
 *  - `step3.schemas.yaml`      Step 3 schemas
 *  - `step4.schemas.yaml`      Step 4 schemas
 *  - `step5.schemas.yaml`      Step 5 schemas
 *
 * They are merged here so `/docs` and `/docs/openapi.yaml` serve one complete document.
 */
function loadSpec(): Record<string, unknown> {
  const spec = readYaml<Record<string, unknown>>(openApiPath);
  const stepOne = readYaml<PathsPart>(path.join(docsDir, 'api.paths.yaml'));
  const catalogue = readYaml<PathsPart>(path.join(docsDir, 'catalogue.paths.yaml'));
  const stepThree = readYaml<PathsPart>(path.join(docsDir, 'step3.paths.yaml'));
  const pricing = readYaml<PathsPart>(path.join(docsDir, 'pricing.paths.yaml'));
  const delivery = readYaml<PathsPart>(path.join(docsDir, 'delivery.paths.yaml'));
  const stepFour = readYaml<PathsPart>(path.join(docsDir, 'step4.paths.yaml'));
  const adminOrders = readYaml<PathsPart>(path.join(docsDir, 'admin-orders.paths.yaml'));
  const stepFive = readYaml<PathsPart>(path.join(docsDir, 'step5.paths.yaml'));
  const schemas = readYaml<SchemasPart>(path.join(docsDir, 'schemas.openapi.yaml'));
  const stepThreeSchemas = readYaml<SchemasPart>(path.join(docsDir, 'step3.schemas.yaml'));
  const stepFourSchemas = readYaml<SchemasPart>(path.join(docsDir, 'step4.schemas.yaml'));
  const stepFiveSchemas = readYaml<SchemasPart>(path.join(docsDir, 'step5.schemas.yaml'));

  const components = (spec.components ?? {}) as Record<string, unknown>;
  spec.components = {
    ...components,
    schemas: {
      ...(schemas.schemas ?? {}),
      ...(stepThreeSchemas.schemas ?? {}),
      ...(stepFourSchemas.schemas ?? {}),
      ...(stepFiveSchemas.schemas ?? {}),
    },
  };
  spec.paths = {
    ...((spec.paths as Record<string, unknown>) ?? {}),
    ...(stepOne.paths ?? {}),
    ...(catalogue.paths ?? {}),
    ...(stepThree.paths ?? {}),
    ...(pricing.paths ?? {}),
    ...(delivery.paths ?? {}),
    ...(stepFour.paths ?? {}),
    ...(adminOrders.paths ?? {}),
    ...(stepFive.paths ?? {}),
  };

  return spec;
}

export const docsRouter = Router();

// The spec is read once at boot; restart the API after editing the docs/ YAML files.
const spec = loadSpec();

docsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').send(YAML.stringify(spec));
});

docsRouter.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: 'Sarvodaya API docs',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
  }),
);
