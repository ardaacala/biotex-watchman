import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { ReviewMembershipRequestBody } from "@workspace/api-zod";
import { adminSessionsTable, adminUsersTable, db } from "@workspace/db";
import { requireManager } from "../lib/auth";

const router: IRouter = Router();

const membershipView = {
  id: adminUsersTable.id,
  username: adminUsersTable.username,
  displayName: adminUsersTable.displayName,
  role: adminUsersTable.role,
  approvalStatus: adminUsersTable.approvalStatus,
  createdAt: adminUsersTable.createdAt,
};

router.get("/membership-requests", requireManager, async (_req, res): Promise<void> => {
  const requests = await db
    .select(membershipView)
    .from(adminUsersTable)
    .where(eq(adminUsersTable.approvalStatus, "pending"))
    .orderBy(desc(adminUsersTable.createdAt));
  res.json(requests);
});

router.patch("/membership-requests/:id", requireManager, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Geçersiz üyelik kimliği." });
    return;
  }

  const parsed = ReviewMembershipRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Geçerli bir onay durumu seçin." });
    return;
  }

  const [updated] = await db
    .update(adminUsersTable)
    .set({ approvalStatus: parsed.data.approvalStatus })
    .where(eq(adminUsersTable.id, id))
    .returning(membershipView);

  if (!updated) {
    res.status(404).json({ error: "Üyelik başvurusu bulunamadı." });
    return;
  }

  if (parsed.data.approvalStatus === "rejected") {
    await db.delete(adminSessionsTable).where(eq(adminSessionsTable.userId, id));
  }
  res.json(updated);
});

export default router;