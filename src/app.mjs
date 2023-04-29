import { extname, parse } from "path";
import { unlink } from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { exec, spawn } from "node:child_process";
import dotenv from "dotenv";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { createS3Client } from "./s3-client.mjs";
import { execSync, spawnSync } from "child_process";

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

    const framesDataRow = execSync(
      `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 ${tmpFile}`
    )
      .toString()
      .trim();

    const allFrames = parseInt(framesDataRow, 10);

    const output = (data) => {
      let str = data
        .toString()
        .split(/(\r\n|\n)+/)
        .filter((i) => i.trim().length);
      str.forEach((row) => {
        if (typeof row === "string" && row.includes("frame=")) {
          const currentFrame = parseInt(row.slice(6), 10);
          const percent = (currentFrame / allFrames) * 100;
          console.log(`${percent.toFixed(2)}%`);
        }
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
        "-progress pipe:1",
        tmpDoneFile,
      ],
      { shell: true, env: { ...process.env } }
    );

    await new Promise((resolve, reject) => {
      proc.stdout.on("data", output);
      proc.on("exit", (code) => {
        if (code === 0) return resolve(true);
        reject(code);
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
}
