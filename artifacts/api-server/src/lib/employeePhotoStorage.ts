import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
export const employeePhotoContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateObjectLocation(relativePath: string) {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  const parts = privateDir.replace(/^\/+/, "").split("/").filter(Boolean);
  const bucketName = parts.shift();
  if (!bucketName) throw new Error("PRIVATE_OBJECT_DIR is invalid");
  const prefix = [...parts, relativePath].join("/");
  return { bucketName, objectName: prefix };
}

export async function createEmployeePhotoUpload() {
  const objectId = randomUUID();
  const objectPath = `/objects/uploads/${objectId}`;
  const { bucketName, objectName } = privateObjectLocation(`uploads/${objectId}`);
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to sign photo upload URL: ${response.status}`);
  }
  const result = await response.json() as { signed_url?: unknown };
  if (typeof result.signed_url !== "string") {
    throw new Error("Object storage returned an invalid signed URL");
  }
  return { uploadURL: result.signed_url, objectPath };
}

export function isEmployeePhotoPath(value: string): boolean {
  return /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getEmployeePhotoFile(objectPath: string): Promise<File | null> {
  if (!isEmployeePhotoPath(objectPath)) return null;
  const relativePath = objectPath.slice("/objects/".length);
  const { bucketName, objectName } = privateObjectLocation(relativePath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  return exists ? file : null;
}

export async function deleteEmployeePhoto(objectPath: string): Promise<void> {
  const file = await getEmployeePhotoFile(objectPath);
  if (file) await file.delete();
}

export async function validateEmployeePhoto(objectPath: string): Promise<boolean> {
  const file = await getEmployeePhotoFile(objectPath);
  if (!file) return false;
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  return Number.isFinite(size) && size > 0 && size <= MAX_PHOTO_SIZE
    && typeof metadata.contentType === "string" && employeePhotoContentTypes.has(metadata.contentType);
}

export async function getValidEmployeePhotoMetadata(file: File) {
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_SIZE
    || typeof metadata.contentType !== "string" || !employeePhotoContentTypes.has(metadata.contentType)) {
    return null;
  }
  return { contentType: metadata.contentType, size };
}