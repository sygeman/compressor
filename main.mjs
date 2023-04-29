import { extname, parse } from "path";
import { unlink } from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
import dotenv from "dotenv";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

dotenv.config();

export class App {
  queue = new Map();
  current = null;
  bucket = process.env["TARGET_BUCKET"];
  inputExt = ".mp4";
  outputExt = ".webm";

  s3Client = new S3Client({
    region: "us-east-1",
    endpoint: process.env["S3_ENDPOINT"],
    credentials: {
      accessKeyId: process.env["S3_ACCESS_KEY"],
      secretAccessKey: process.env["S3_SECRET_KEY"],
    },
  });

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
    const tmpFile = `./tmp/${item.etag}${this.inputExt}`;
    const tmpDoneFile = `./tmp/${item.etag}${this.outputExt}`;

    const readObjectResult = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: item.name })
    );

    await pipeline(readObjectResult.Body, createWriteStream(tmpFile));

    const output = (data) => {
      let str = data
        .toString()
        .split(/(\r\n|\n)+/)
        .filter((i) => i.trim().length);
      str.forEach((row) => {
        console.log(row);
      });
    };

    let proc = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        tmpFile,
        "-c:v libvpx-vp9",
        "-crf 40",
        "-deadline realtime",
        "-cpu-used -8",
        tmpDoneFile,
      ],
      { shell: true, env: { ...process.env } }
    );

    await new Promise((resolve, reject) => {
      proc.stdout.on("data", output);
      proc.stderr.on("data", output);
      proc.on("exit", (code) => {
        if (code === 0) return resolve(true);
        reject();
      });
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

  async test() {
    const name = "sample.mp4";
    const file = await this.s3Client.send(
      new PutObjectCommand({
        Key: name,
        Bucket: this.bucket,
        Body: createReadStream(`./assets/${name}`),
      })
    );

    if (!file?.ETag) return;

    await this.compress({ etag: file.ETag.slice(1, -1), name });

    return this.s3Client.send(
      new DeleteObjectCommand({ Key: "sample.webm", Bucket: this.bucket })
    );
  }
}

const app = new App();
app.run();
