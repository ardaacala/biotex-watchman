import type { NextFunction, Request, Response } from "express";

function hasApprovedRole(res: Response, roles: readonly string[]): boolean {
  const user = res.locals.user;
  return user?.approvalStatus === "approved" && roles.includes(user.role);
}

export function requireManager(_req: Request, res: Response, next: NextFunction): void {
  if (!hasApprovedRole(res, ["manager"])) {
    res.status(403).json({ error: "Bu işlem yalnızca yöneticiler tarafından yapılabilir." });
    return;
  }
  next();
}

export function requireWorkforceEditor(_req: Request, res: Response, next: NextFunction): void {
  if (!hasApprovedRole(res, ["manager", "hr"])) {
    res.status(403).json({ error: "Bu işlem için onaylı yönetici veya İK yetkisi gereklidir." });
    return;
  }
  next();
}