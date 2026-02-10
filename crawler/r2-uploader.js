import fs from "fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * R2 Uploader — uploads skill zips and registry files to Cloudflare R2.
 *
 * Environment variables:
 *   R2_ACCESS_KEY_ID     — Cloudflare R2 access key
 *   R2_SECRET_ACCESS_KEY — Cloudflare R2 secret key
 *   R2_ENDPOINT          — S3-compatible endpoint (https://<account-id>.r2.cloudflarestorage.com)
 */

let _client = null;

function getClient() {
  if (_client) return _client;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

/**
 * Check if R2 upload is configured
 * @returns {boolean}
 */
export function isR2Configured() {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );
}

/**
 * Upload a file to R2 with auto-detected content type.
 * @param {string} localPath — absolute path to the file
 * @param {string} r2Key    — object key in the bucket
 * @param {string} bucket   — R2 bucket name
 * @returns {Promise<void>}
 */
export async function uploadToR2(localPath, r2Key, bucket) {
  const client = getClient();
  if (!client) throw new Error("R2 client not configured");

  const body = await fs.readFile(localPath);
  const isJson = r2Key.endsWith(".json");
  const contentType = isJson ? "application/json; charset=utf-8" : "application/zip";

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: r2Key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Build the R2 object key for a skill zip.
 * @param {string} prefix — e.g. "zips/"
 * @param {string} owner
 * @param {string} repo
 * @param {string} skillName
 * @returns {string}
 */
export function buildR2Key(prefix, owner, repo, skillName) {
  return `${prefix}${owner}-${repo}-${skillName}.zip`;
}

