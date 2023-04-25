import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MinioModule, MinioService } from 'nestjs-minio-client';
import { extname, parse } from 'path';
import * as ffmpeg from 'fluent-ffmpeg';
import { unlink } from 'fs/promises';
import type { BucketItem } from 'minio';

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
})
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger();

  constructor(
    private readonly minioService: MinioService,
    private configService: ConfigService,
  ) {}

  queue: Map<string, { item: BucketItem }> = new Map();
  current: string | null = null;
  progress = 0;
  bucket = this.configService.get('TARGET_BUCKET');
  inputExt = '.mp4';
  outputExt = '.webm';

  async fetchBucket() {
    const stream = this.minioService.client.listObjectsV2(this.bucket);
    stream.on('data', (item) => {
      if (extname(item.name) === this.inputExt && !this.queue.has(item.etag)) {
        this.queue.set(item.etag, { item });
        if (this.current === null) this.getNext();
      }
    });
  }

  async getNext() {
    if (this.queue.size === 0) return;
    const [{ item }] = this.queue.values();
    this.current = item.etag;
    this.compress(item);
  }

  async compress(item: BucketItem) {
    const name = parse(item.name).name;
    const tmpFile = `./tmp/${item.etag}${this.inputExt}`;
    const tmpDoneFile = `./tmp/${item.etag}${this.outputExt}`;
    await this.minioService.client.fGetObject(this.bucket, item.name, tmpFile);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(tmpFile)
        .inputOptions('-hwaccel auto')
        .save(tmpDoneFile)
        .on('progress', ({ percent }) => (this.progress = percent.toFixed(2)))
        .on('error', (err) => reject(err))
        .on('end', async () => {
          await unlink(tmpFile);
          resolve(true);
        });
    });

    await this.minioService.client.fPutObject(
      this.bucket,
      `${name}${this.outputExt}`,
      tmpDoneFile,
    );
    await unlink(tmpDoneFile);
    await this.minioService.client.removeObject(this.bucket, item.name);

    this.queue.delete(item.etag);
    this.current = null;
    this.progress = 0;

    this.getNext();
  }

  onApplicationBootstrap() {
    this.fetchBucket();

    setInterval(() => {
      if (this.current) {
        const item = this.queue.get(this.current);
        this.logger.log(`${item.item.name}: ${this.progress}%`);
      }
      this.fetchBucket();
    }, 5000);
  }
}
