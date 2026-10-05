import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { ReviewMembershipRequestBody } from "@workspace/api-zod";
import { adminSessionsTable, adminUsersTable, db } from "@workspace/db";
import { requireManager } from "../lib/auth";
import { isApprovedManager } from "../lib/account-policy";

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

  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(9042026)`);
    const [actor] = await tx.select(membershipView).from(adminUsersTable).where(eq(adminUsersTable.id, res.locals.user.id));
    if (!isApprovedManager(actor)) return { error: "Yönetici yetkiniz artık geçerli değil.", status: 403 } as const;
    const [target] = await tx.select(membershipView).from(adminUsersTable).where(eq(adminUsersTable.id, id));
    if (!target) return { error: "Üyelik başvurusu bulunamadı.", status: 404 } as const;
    // Reviewing a membership must not revoke an existing manager or bypass last-manager protection.
    if (target.approvalStatus !== "pending") return { error: "Bu üyelik başvurusu zaten karara bağlanmış.", status: 409 } as const;
    const [updated] = await tx.update(adminUsersTable)
      .set({ approvalStatus: parsed.data.approvalStatus })
      .where(eq(adminUsersTable.id, id)).returning(membershipView);
    if (parsed.data.approvalStatus === "rejected") {
      await tx.delete(adminSessionsTable).where(eq(adminSessionsTable.userId, id));
    }
    return { member: updated };
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.json(result.member);
});

export default router;