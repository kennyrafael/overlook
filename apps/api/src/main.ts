import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { API_PORT } from '@overlook/shared';
import { AppModule } from './app.module';
import { configure } from './configure';

async function bootstrap() {
  const port = Number(process.env.CPD_PORT) || API_PORT;
  const app = configure(await NestFactory.create(AppModule));
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
}
bootstrap();
