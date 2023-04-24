import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MinioModule } from 'nestjs-minio-client';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MinioModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        endPoint: configService.get('MINIO_ENDPOINT'),
        port: parseInt(configService.get('MINIO_PORT')),
        useSSL: false,
        accessKey: configService.get('MINIO_ACCESS_KEY'),
        secretKey: configService.get('MINIO_SECRET_KEY'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
