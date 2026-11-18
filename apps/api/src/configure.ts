import type { INestApplication } from '@nestjs/common';
import { CLIENT_HEADER, localOnly } from './common/local-only.middleware';

/** Shared HTTP setup for the server and the end-to-end tests. */
export function configure(app: INestApplication) {
  app.use(localOnly);
  app.setGlobalPrefix('api');
  // Local-only: allow the Vite dev server origin, nothing else.
  app.enableCors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], allowedHeaders: ['Content-Type', CLIENT_HEADER] });
  app.enableShutdownHooks();
  return app;
}
