import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { App } from "./app.mjs";
import { createReadStream } from "fs";

const app = new App();

(async () => {
  const name = "sample.mp4";
  const file = await app.s3Client.send(
    new PutObjectCommand({
      Key: name,
      Bucket: app.bucket,
      Body: createReadStream(`./assets/${name}`),
    })
  );

  if (!file?.ETag) return;

  await app.compress({ etag: file.ETag.slice(1, -1), name });

  return app.s3Client.send(
    new DeleteObjectCommand({ Key: "sample.webm", Bucket: app.bucket })
  );
})();
