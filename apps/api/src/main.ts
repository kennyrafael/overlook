import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { API_PORT } from '@overlook/shared';
import { AppModule } from './app.module';
import { configure } from './configure';
import { logDir } from './database/database.config';
import { FileLogger } from './common/file-logger';

/** Electron utilityProcess message port (only present when started by the desktop app). */
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data?: { type?: string } }) => void): void;
}

async function bootstrap() {
  const port = Number(process.env.CPD_PORT) || API_PORT;
  const app = configure(await NestFactory.create(AppModule, { logger: new FileLogger(logDir) }));
  try {
    await app.listen(port, '127.0.0.1');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Is the dashboard already running? (set CPD_PORT to use another port)`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`\n  Overlook → http://127.0.0.1:${port}\n`);
  // When started by the desktop app (Electron utilityProcess), tell it the server is ready and
  // shut down cleanly (watchers, database) when it asks.
  const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
  parentPort?.on('message', (e) => {
    if (e?.data?.type === 'shutdown') app.close().finally(() => process.exit(0));
  });
  parentPort?.postMessage({ type: 'ready', port });
}
bootstrap();
