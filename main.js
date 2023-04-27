import { extname, parse } from "path";
import ffmpeg from "fluent-ffmpeg";
import { unlink } from "fs/promises";
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

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(tmpFile)
        .withOptions(["-c:v libvpx-vp9", "-crf 40", "-deadline best"])
        .save(tmpDoneFile)
        .on("progress", ({ percent }) => console.log(name, percent.toFixed(2)))
        .on("error", (err) => reject(err))
        .on("end", async () => {
          await unlink(tmpFile);
          resolve(true);
        });
    });

    await this.minioClient.fPutObject(
      this.bucket,
      `${name}${this.outputExt}`,
      tmpDoneFile
    );
    await unlink(tmpDoneFile);
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
