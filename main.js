import { extname, parse } from "path";
import { unlink } from "fs/promises";
import { spawn } from "child_process";
import Minio from "minio";
import dotenv from "dotenv";

dotenv.config();

export class App {
  queue = new Map();
  current = null;
  bucket = process.env["TARGET_BUCKET"];
  inputExt = ".mp4";
  outputExt = ".webm";

  minioClient = new Minio.Client({
    endPoint: process.env["MINIO_ENDPOINT"],
    port: parseInt(process.env["MINIO_PORT"]),
    useSSL: false,
    accessKey: process.env["MINIO_ACCESS_KEY"],
    secretKey: process.env["MINIO_SECRET_KEY"],
  });

  async fetchBucket() {
    const stream = this.minioClient.listObjectsV2(this.bucket);
    stream.on("data", (item) => {
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
    await this.compress(item);
    this.queue.delete(item.etag);
    this.current = null;
    this.getNext();
  }

  async compress(item) {
    const name = parse(item.name).name;
    const tmpFile = `./tmp/${item.etag}${this.inputExt}`;
    const tmpDoneFile = `./tmp/${item.etag}${this.outputExt}`;
    await this.minioClient.fGetObject(this.bucket, item.name, tmpFile);

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

    await this.minioClient.fPutObject(
      this.bucket,
      `${name}${this.outputExt}`,
      tmpDoneFile
    );

    return Promise.all([
      unlink(tmpFile),
      unlink(tmpDoneFile),
      this.minioClient.removeObject(this.bucket, item.name),
    ]);
  }

  run() {
    this.fetchBucket();
    setInterval(() => this.fetchBucket(), 5000);
  }

  async test() {
    const name = "sample.mp4";
    const { etag } = await this.minioClient.fPutObject(
      this.bucket,
      name,
      `./assets/${name}`
    );

    await this.compress({ etag, name });
    return this.minioClient.removeObject(this.bucket, "sample.webm");
  }
}

const app = new App();
app.run();
