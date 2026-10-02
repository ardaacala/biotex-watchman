import { Router, type IRouter } from "express";
import { count, eq, sql } from "drizzle-orm";
import { db, adminSessionsTable, adminUsersTable } from "@workspace/db";
import {
  clearSessionCookie,
  createSession,
  getSessionUser,
  hashPassword,
  hashSessionToken,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();
const usernamePattern = /^[a-zA-Z0-9._-]{3,32}$/;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function validPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 8;
}

router.get("/auth/status", async (req, res): Promise<void> => {
  const [{ value }] = await db.select({ value: count() }).from(adminUsersTable);
  const user = await getSessionUser(req);
  res.json({ setupRequired: value === 0, user });
});

router.post("/auth/setup", async (req, res): Promise<void> => {
  const username = typeof req.body.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
  const password = req.body.password;

  if (!usernamePattern.test(username) || !displayName || displayName.length > 80 || !validPassword(password)) {
    res.status(400).json({ error: "Geçerli bir kullanıcı adı, ad soyad ve boş olmayan bir şifre girin." });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(9042026)`);
      const [{ value }] = await tx.select({ value: count() }).from(adminUsersTable);
      if (value > 0) return null;
      const [created] = await tx
        .insert(adminUsersTable)
        .values({ username, displayName, passwordHash, approvalStatus: "approved" })
        .returning({ id: adminUsersTable.id, username: adminUsersTable.username, displayName: adminUsersTable.displayName });
      return created;
    });
    if (!user) {
      res.status(403).json({ error: "İlk yönetici hesabı daha önce oluşturulmuş." });
      return;
    }
    const session = await createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json({ user });
  } catch (error) {
    req.log.warn({ err: error }, "Initial admin account creation failed");
    res.status(409).json({ error: "Yönetici hesabı oluşturulamadı." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const username = typeof req.body.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const password = req.body.password;
  if (!username || typeof password !== "string") {
    res.status(400).json({ error: "Kullanıcı adı ve şifre gereklidir." });
    return;
  }

  const attemptKey = `${req.ip}:${username}`;
  const now = Date.now();
  const attempts = loginAttempts.get(attemptKey);
  if (attempts && attempts.resetAt > now && attempts.count >= 5) {
    res.status(429).json({ error: "Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin." });
    return;
  }

  const [account] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.username, username)).limit(1);
  if (!account || !(await verifyPassword(password, account.passwordHash))) {
    loginAttempts.set(attemptKey, {
      count: attempts && attempts.resetAt > now ? attempts.count + 1 : 1,
      resetAt: attempts && attempts.resetAt > now ? attempts.resetAt : now + 15 * 60 * 1000,
    });
    res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
    return;
  }

  if (account.approvalStatus === "pending") {
    res.status(403).json({ error: "Üyeliğiniz yönetici onayı bekliyor." });
    return;
  }
  if (account.approvalStatus === "rejected") {
    res.status(403).json({ error: "Üyelik başvurunuz kabul edilmedi." });
    return;
  }

  loginAttempts.delete(attemptKey);
  const session = await createSession(account.id);
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ user: { id: account.id, username: account.username, displayName: account.displayName } });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const username = typeof req.body.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
  const password = req.body.password;

  if (!usernamePattern.test(username) || !displayName || displayName.length > 80 || !validPassword(password)) {
    res.status(400).json({ error: "Geçerli bir ad soyad, kullanıcı adı ve en az 8 karakterli şifre girin." });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    await db.insert(adminUsersTable).values({
      username,
      displayName,
      passwordHash,
      role: "hr",
      approvalStatus: "pending",
    });
    res.status(201).json({ message: "Üyelik başvurunuz alındı. Yönetici onayından sonra giriş yapabilirsiniz." });
  } catch (error) {
    req.log.warn({ err: error }, "Membership registration failed");
    res.status(409).json({ error: "Bu kullanıcı adı kullanılıyor veya başvuru oluşturulamadı." });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token) {
    await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, hashSessionToken(token)));
  }
  clearSessionCookie(res);
  res.sendStatus(204);
});

export default router;