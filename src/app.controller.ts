import { Body, Controller, Get, Post } from '@nestjs/common';
import { MinioService } from 'nestjs-minio-client';
import * as ffmpeg from 'fluent-ffmpeg';
import { unlink } from 'fs/promises';
import { VideoDto } from './dto/video.dto';

@Controller()
export class AppController {
  constructor(private readonly minioService: MinioService) {}

  async compress({ input, output }: { input: string; output: string }) {
    const [inputBucket, inputFile] = input.split('/');
    const [outputBucket, outputFile] = output.split('/');

    const tmpFile = `./tmp/${inputFile}`;
    const tmpDoneFile = `./tmp/done_${inputFile}`;

    await this.minioService.client.fGetObject(inputBucket, inputFile, tmpFile);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(tmpFile)
        .inputOptions('-hwaccel auto')
        .save(tmpDoneFile)
        .on('progress', (progress) => {
          // console.log(progress.percent);
        })
        .on('error', (err) => reject(err))
        .on('end', async () => {
          await unlink(tmpFile);
          resolve(true);
        });
    });

    await this.minioService.client.fPutObject(
      outputBucket,
      outputFile,
      tmpDoneFile,
    );

    return unlink(tmpDoneFile);
  }

  @Post()
  async video(@Body() videoDto: VideoDto): Promise<string> {
    console.log({ input: videoDto.input, output: videoDto.output });
    await this.compress({ input: videoDto.input, output: videoDto.output });
    return 'done';
  }
}
