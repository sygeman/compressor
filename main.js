import { extname, parse } from "path";
import { unlink } from "fs/promises";
import { spawn } from "child_process";
import Minio from "minio";
import dotenv from "dotenv";

dotenv.config();

export class App {
  queue = new Map();
  current = null;
  progress = 0;
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
    this.compress(item);
  }

  async compress(item) {
    const name = parse(item.name).name;
    const tmpFile = `./tmp/${item.etag}${this.inputExt}`;
    const tmpDoneFile = `./tmp/${item.etag}${this.outputExt}`;
    await this.minioClient.fGetObject(this.bucket, item.name, tmpFile);

    const output = () => (data) => {
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
        "-deadline best",
        tmpDoneFile,
      ],
      {
        shell: true,
        env: { ...process.env },
      }
    );

    await new Promise((resolve) => {
      proc.stdout.on("data", output("data"));
      proc.stderr.on("data", output("error"));
      proc.on("exit", (code) => {
        console.log(`Child exited with code ${code}`);
        resolve(true);
      });
    });

    await this.minioClient.fPutObject(
      this.bucket,
      `${name}${this.outputExt}`,
      tmpDoneFile
    );
    unlink(tmpFile);
    unlink(tmpDoneFile);
    await this.minioClient.removeObject(this.bucket, item.name);

    this.queue.delete(item.etag);
    this.current = null;
    this.progress = 0;

    this.getNext();
  }

  run() {
    this.fetchBucket();
    setInterval(() => this.fetchBucket(), 5000);
  }
}

const app = new App();
app.run();
