import { extname, parse } from "node:path";
import { unlink } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import dotenv from "dotenv";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import { createS3Client } from "./s3-client.mjs";
import { convertMp4ToWebm } from "./convert-mp4-to-webm.mjs";

dotenv.config();

export class App {
  queue = new Map();
  current = null;
  bucket = process.env["TARGET_BUCKET"];
  tmp = "./tmp/";
  inputExt = ".mp4";
  outputExt = ".webm";
  s3Client = createS3Client();

  async fetchBucket() {
    const data = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 3,
      })
    );

    data.Contents?.forEach((item) => {
      if (!item?.Key || !item?.ETag) return;
      if (extname(item.Key) !== this.inputExt) return;
      const etag = item.ETag.slice(1, -1);

      if (!this.queue.has(etag)) {
        this.queue.set(etag, { name: item.Key, etag });
        if (this.current === null) this.getNext();
      }
    });
  }

  async getNext() {
    if (this.queue.size === 0) return;
    const [item] = this.queue.values();
    this.current = item.etag;
    await this.compress(item);
    this.queue.delete(item.etag);
    this.current = null;
    this.getNext();
  }

  async compress(item) {
    const name = parse(item.name).name;
    const tmpFile = `${this.tmp}${item.etag}${this.inputExt}`;
    const tmpDoneFile = `${this.tmp}${item.etag}${this.outputExt}`;

    const readObjectResult = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: item.name })
    );

    await pipeline(readObjectResult.Body, createWriteStream(tmpFile));

    await convertMp4ToWebm({
      inputFile: tmpFile,
      outputFile: tmpDoneFile,
      onProgress: (value) => console.log(`${value.toFixed(2)}%`),
    });

    await this.s3Client.send(
      new PutObjectCommand({
        Key: `${name}${this.outputExt}`,
        Bucket: this.bucket,
        Body: createReadStream(tmpDoneFile),
      })
    );

    return Promise.all([
      unlink(tmpFile),
      unlink(tmpDoneFile),
      this.s3Client.send(
        new DeleteObjectCommand({ Key: item.name, Bucket: this.bucket })
      ),
    ]);
  }

  run() {
    this.fetchBucket();
    setInterval(() => this.fetchBucket(), 5000);
  }
}
