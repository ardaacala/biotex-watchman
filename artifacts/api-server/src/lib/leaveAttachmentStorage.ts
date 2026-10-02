import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
export const MAX_LEAVE_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const leaveAttachmentContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

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
  return { bucketName, objectName: [...parts, relativePath].join("/") };
}

export async function createLeaveAttachmentUpload(name: string, size: number, contentType: string) {
  validateLeaveAttachmentMetadata(name, size, contentType);
  const objectId = randomUUID();
  const objectPath = `/objects/leave-attachments/${objectId}`;
  const { bucketName, objectName } = privateObjectLocation(`leave-attachments/${objectId}`);
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
  if (!response.ok) throw new Error(`Failed to sign leave attachment upload URL: ${response.status}`);
  const result = await response.json() as { signed_url?: unknown };
  if (typeof result.signed_url !== "string") {
    throw new Error("Object storage returned an invalid signed URL");
  }
  return { uploadURL: result.signed_url, objectPath };
}

export function validateLeaveAttachmentMetadata(name: string, size: number, contentType: string): void {
  if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\r\n\0]/.test(name)) {
    throw new Error("Invalid attachment name");
  }
  if (!Number.isInteger(size) || size <= 0 || size > MAX_LEAVE_ATTACHMENT_SIZE) {
    throw new Error("Invalid attachment size");
  }
  if (!leaveAttachmentContentTypes.has(contentType)) {
    throw new Error("Unsupported attachment content type");
  }
}

export function isLeaveAttachmentPath(value: string): boolean {
  return /^\/objects\/leave-attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getLeaveAttachmentFile(objectPath: string): Promise<File | null> {
  if (!isLeaveAttachmentPath(objectPath)) return null;
  const relativePath = objectPath.slice("/objects/".length);
  const { bucketName, objectName } = privateObjectLocation(relativePath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  return exists ? file : null;
}

export async function validateUploadedLeaveAttachment(
  objectPath: string,
  name: string,
  declaredSize: number,
  declaredContentType: string,
): Promise<boolean> {
  validateLeaveAttachmentMetadata(name, declaredSize, declaredContentType);
  const file = await getLeaveAttachmentFile(objectPath);
  if (!file) return false;
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  return Number.isInteger(size) && size === declaredSize
    && metadata.contentType === declaredContentType
    && size > 0 && size <= MAX_LEAVE_ATTACHMENT_SIZE
    && typeof metadata.contentType === "string"
    && leaveAttachmentContentTypes.has(metadata.contentType);
}

export function safeAttachmentFilename(name: string): { fallback: string; encoded: string } {
  const cleaned = name.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").trim();
  const filename = cleaned || "attachment";
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return { fallback: fallback.slice(0, 180) || "attachment", encoded };
}