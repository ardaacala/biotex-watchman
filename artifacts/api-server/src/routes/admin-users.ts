import { Router, type IRouter } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  DeleteManagedUserParams,
  ListManagedUsersResponse,
  ResetManagedUserPasswordBody,
  ResetManagedUserPasswordParams,
  UpdateManagedUserRoleBody,
  UpdateManagedUserRoleParams,
  UpdateManagedUserRoleResponse,
} from "@workspace/api-zod";
import { adminSessionsTable, adminUsersTable, db } from "@workspace/db";
import { clearSessionCookie, hashPassword, requireManager } from "../lib/auth";
import { accountChangeError, isApprovedManager } from "../lib/account-policy";

const router: IRouter = Router();
// Deliberately select no password hash or session token, including mutation responses.
const memberView = {
  id: adminUsersTable.id,
  username: adminUsersTable.username,
  displayName: adminUsersTable.displayName,
  role: adminUsersTable.role,
  approvalStatus: adminUsersTable.approvalStatus,
  createdAt: adminUsersTable.createdAt,
};
const serializeMember = (member: { createdAt: Date }) => ({ ...member, createdAt: member.createdAt.toISOString() });

router.get("/admin/users", requireManager, async (_req, res): Promise<void> => {
  const members = await db.select(memberView).from(adminUsersTable).orderBy(desc(adminUsersTable.createdAt));
  res.setHeader("Cache-Control", "no-store");
  res.json(ListManagedUsersResponse.parse(members.map(serializeMember)));
});

router.patch("/admin/users/:id/role", requireManager, async (req, res): Promise<void> => {
  const params = UpdateManagedUserRoleParams.safeParse(req.params);
  const body = UpdateManagedUserRoleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Geçerli bir kullanıcı ve yetki seçin." });
    return;
  }
  const result = await db.transaction(async tx => {
    // Serialize privileged changes and first-account setup to prevent last-manager races.
    await tx.execute(sql`select pg_advisory_xact_lock(9042026)`);
    const [actor] = await tx.select(memberView).from(adminUsersTable).where(eq(adminUsersTable.id, res.locals.user.id));
    if (!isApprovedManager(actor)) return { error: "Yönetici yetkiniz artık geçerli değil.", status: 403 } as const;
    const [target] = await tx.select(memberView).from(adminUsersTable).where(eq(adminUsersTable.id, params.data.id));
    if (!target) return { error: "Üye bulunamadı.", status: 404 } as const;
    const [{ value }] = await tx.select({ value: count() }).from(adminUsersTable)
      .where(and(eq(adminUsersTable.role, "manager"), eq(adminUsersTable.approvalStatus, "approved")));
    const error = accountChangeError(actor.id, target, value, "role", body.data.role);
    if (error) return { error, status: 409 } as const;
    if (target.role === body.data.role) return { member: target };
    const [updated] = await tx.update(adminUsersTable).set({ role: body.data.role })
      .where(eq(adminUsersTable.id, target.id)).returning(memberView);
    await tx.delete(adminSessionsTable).where(eq(adminSessionsTable.userId, target.id));
    return { member: updated };
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.json(UpdateManagedUserRoleResponse.parse(serializeMember(result.member)));
});

router.post("/admin/users/:id/password", requireManager, async (req, res): Promise<void> => {
  const params = ResetManagedUserPasswordParams.safeParse(req.params);
  const body = ResetManagedUserPasswordBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Yeni şifre 8–128 karakter uzunluğunda olmalıdır." });
    return;
  }
  const passwordHash = await hashPassword(body.data.password);
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(9042026)`);
    const [actor] = await tx.select(memberView).from(adminUsersTable).where(eq(adminUsersTable.id, res.locals.user.id));
    if (!isApprovedManager(actor)) return { error: "Yönetici yetkiniz artık geçerli değil.", status: 403 } as const;
    const [updated] = await tx.update(adminUsersTable).set({ passwordHash })
      .where(eq(adminUsersTable.id, params.data.id)).returning({ id: adminUsersTable.id });
    if (!updated) return { error: "Üye bulunamadı.", status: 404 } as const;
    await tx.delete(adminSessionsTable).where(eq(adminSessionsTable.userId, updated.id));
    return { changed: true } as const;
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  if (params.data.id === res.locals.user.id) clearSessionCookie(res);
  res.sendStatus(204);
});

router.delete("/admin/users/:id", requireManager, async (req, res): Promise<void> => {
  const params = DeleteManagedUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Geçersiz kullanıcı." });
    return;
  }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(9042026)`);
    const [actor] = await tx.select(memberView).from(adminUsersTable).where(eq(adminUsersTable.id, res.locals.user.id));
    if (!isApprovedManager(actor)) return { error: "Yönetici yetkiniz artık geçerli değil.", status: 403 } as const;
    const [target] = await tx.select(memberView).from(adminUsersTable).where(eq(adminUsersTable.id, params.data.id));
    if (!target) return { error: "Üye bulunamadı.", status: 404 } as const;
    const [{ value }] = await tx.select({ value: count() }).from(adminUsersTable)
      .where(and(eq(adminUsersTable.role, "manager"), eq(adminUsersTable.approvalStatus, "approved")));
    const error = accountChangeError(actor.id, target, value, "delete");
    if (error) return { error, status: 409 } as const;
    // Login accounts are separate from employee/leave records; sessions cascade.
    await tx.delete(adminUsersTable).where(eq(adminUsersTable.id, target.id));
    return { deleted: true } as const;
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.sendStatus(204);
});

export default router;
