import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";

const endpoint = process.env.MINIO_ENDPOINT;
const accessKeyId = process.env.MINIO_ACCESS_KEY;
const secretAccessKey = process.env.MINIO_SECRET_KEY;
const bucket = process.env.MINIO_BUCKET;

if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error(
    "MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, and MINIO_BUCKET must all be set."
  );
}

const s3 = new S3Client({
  endpoint,
  region: "us-east-1", // ignored by MinIO, but the SDK requires a value
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true, // required for MinIO and most other S3-compatible stores
});

export async function uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
  );
}

export async function getObjectStream(key: string): Promise<{ body: Readable; contentType?: string }> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return { body: result.Body as Readable, contentType: result.ContentType };
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const { body } = await getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
