import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db, adminSessionsTable, adminUsersTable } from "@workspace/db";
import type { NextFunction, Request, Response } from "express";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "vardiya_session";
const SESSION_DAYS = 7;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(adminSessionsTable).values({
    userId,
    tokenHash: tokenHash(token),
    expiresAt,
  });
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export async function getSessionUser(req: Request) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) return null;

  const [result] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
      approvalStatus: adminUsersTable.approvalStatus,
    })
    .from(adminSessionsTable)
    .innerJoin(adminUsersTable, eq(adminSessionsTable.userId, adminUsersTable.id))
    .where(
      and(
        eq(adminSessionsTable.tokenHash, tokenHash(token)),
        gt(adminSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return result?.approvalStatus === "approved" ? result : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Bu alan yalnızca yetkili yöneticilere açıktır." });
    return;
  }
  res.locals.user = user;
  next();
}

export function requireManager(_req: Request, res: Response, next: NextFunction): void {
  if (res.locals.user?.role !== "manager") {
    res.status(403).json({ error: "Bu işlem yalnızca yöneticiler tarafından yapılabilir." });
    return;
  }
  next();
}

export function hashSessionToken(token: string): string {
  return tokenHash(token);
}