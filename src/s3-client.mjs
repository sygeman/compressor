import { S3Client } from "@aws-sdk/client-s3";

export const createS3Client = () =>
  new S3Client({
    region: "us-east-1",
    endpoint: process.env["S3_ENDPOINT"],
    credentials: {
      accessKeyId: process.env["S3_ACCESS_KEY"],
      secretAccessKey: process.env["S3_SECRET_KEY"],
    },
  });
