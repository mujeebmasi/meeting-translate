import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { MOCK } from './mock-flag';

async function bootstrap() {
  if (MOCK) {
    console.warn(
      'MOCK=1: captions are fake demo text, not real speech-to-text or translation.',
    );
  } else {
    for (const key of ['FISH_API_KEY', 'DEEPSEEK_API_KEY']) {
      if (!process.env[key])
        console.warn(
          `Warning: ${key} is not set. Translation will fail until it is.`,
        );
    }
  }

  const app = await NestFactory.create(AppModule);

  // Every route starts with /api
  app.setGlobalPrefix('api');

  // Checks incoming request bodies against the DTO classes.
  // whitelist strips any extra fields the client sent that we did not ask for.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // The browser blocks requests to a different origin unless we allow it.
  const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim());
  app.enableCors({ origin: allowedOrigins });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api`);
}

void bootstrap();
