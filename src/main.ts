import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const prefix = config.get<string>('apiPrefix') ?? 'api/v1';
  app.setGlobalPrefix(prefix);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Inventory Management API')
    .setDescription(
      'Products, multi-warehouse stock, movements, purchase orders, batches, valuation and reporting.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/${prefix}`);
  logger.log(`Swagger docs at http://localhost:${port}/${prefix}/docs`);
}

void bootstrap();
