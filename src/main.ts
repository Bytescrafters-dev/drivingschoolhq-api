import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureCors } from './config/cors.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureCors(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
