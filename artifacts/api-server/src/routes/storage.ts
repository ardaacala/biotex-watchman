import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  GetEmployeePhotoParams,
  RequestLeaveAttachmentUploadUrlBody,
  RequestLeaveAttachmentUploadUrlResponse,
  RequestEmployeePhotoUploadUrlBody,
  RequestEmployeePhotoUploadUrlResponse,
} from "@workspace/api-zod";
import { db, employeesTable } from "@workspace/db";
import { requireManager } from "../lib/auth";
import {
  createEmployeePhotoUpload,
  employeePhotoContentTypes,
  getEmployeePhotoFile,
  getValidEmployeePhotoMetadata,
} from "../lib/employeePhotoStorage";
import { createLeaveAttachmentUpload } from "../lib/leaveAttachmentStorage";

const router: IRouter = Router();

router.post("/storage/leave-attachments/upload-url", async (req, res): Promise<void> => {
  const parsed = RequestLeaveAttachmentUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const upload = await createLeaveAttachmentUpload(
      parsed.data.name,
      parsed.data.size,
      parsed.data.contentType,
    );
    res.json(RequestLeaveAttachmentUploadUrlResponse.parse(upload));
  } catch (error) {
    req.log.error({ err: error }, "Failed to create leave attachment upload URL");
    res.status(500).json({ error: "Failed to create leave attachment upload URL" });
  }
});

router.post("/storage/photos/upload-url", requireManager, async (req, res): Promise<void> => {
  const parsed = RequestEmployeePhotoUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const upload = await createEmployeePhotoUpload();
    res.json(RequestEmployeePhotoUploadUrlResponse.parse(upload));
  } catch (error) {
    req.log.error({ err: error }, "Failed to create employee photo upload URL");
    res.status(500).json({ error: "Failed to create employee photo upload URL" });
  }
});

router.get("/storage/photos/:employeeId", async (req, res): Promise<void> => {
  const params = GetEmployeePhotoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid employee ID" });
    return;
  }
  try {
    const [employee] = await db.select({ photoPath: employeesTable.photoPath })
      .from(employeesTable)
      .where(eq(employeesTable.id, params.data.employeeId));
    if (!employee?.photoPath) {
      res.status(404).json({ error: "Employee photo not found" });
      return;
    }
    const file = await getEmployeePhotoFile(employee.photoPath);
    if (!file) {
      res.status(404).json({ error: "Employee photo not found" });
      return;
    }
    const metadata = await getValidEmployeePhotoMetadata(file);
    if (!metadata || !employeePhotoContentTypes.has(metadata.contentType)) {
      res.status(404).json({ error: "Employee photo is unavailable" });
      return;
    }
    res.setHeader("Content-Type", metadata.contentType);
    res.setHeader("Content-Length", String(metadata.size));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const stream = file.createReadStream();
    stream.on("error", (error) => {
      req.log.error({ err: error, employeeId: params.data.employeeId }, "Failed to stream employee photo");
      if (res.headersSent) res.destroy(error);
      else res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    req.log.error({ err: error, employeeId: params.data.employeeId }, "Failed to serve employee photo");
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve employee photo" });
    else res.destroy(error as Error);
  }
});

export default router;