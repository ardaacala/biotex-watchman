import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accountChangeError, isApprovedManager } from "./account-policy.ts";

test("only approved managers qualify for account administration", () => {
  assert.equal(isApprovedManager({ role: "manager", approvalStatus: "approved" }), true);
  for (const member of [undefined, { role: "hr", approvalStatus: "approved" }, { role: "manager", approvalStatus: "pending" }]) {
    assert.equal(isApprovedManager(member), false);
  }
});

test("self deletion and self demotion are blocked even with another manager", () => {
  const self = { id: 1, role: "manager", approvalStatus: "approved" };
  assert.ok(accountChangeError(1, self, 2, "delete"));
  assert.ok(accountChangeError(1, self, 2, "role", "hr"));
  assert.equal(accountChangeError(1, self, 2, "role", "manager"), null);
});

test("last approved manager cannot be removed, other accounts can", () => {
  const manager = { id: 2, role: "manager", approvalStatus: "approved" };
  assert.ok(accountChangeError(1, manager, 1, "delete"));
  assert.ok(accountChangeError(1, manager, 1, "role", "hr"));
  assert.equal(accountChangeError(1, manager, 2, "delete"), null);
  assert.equal(accountChangeError(1, manager, 2, "role", "hr"), null);
  assert.equal(accountChangeError(1, { ...manager, role: "hr" }, 1, "delete"), null);
});

test("all account management routes enforce manager-only access", () => {
  const source = readFileSync(new URL("../routes/admin-users.ts", import.meta.url), "utf8");
  const routes = [...source.matchAll(/router\.(get|post|patch|delete)\("([^"]+)",\s*(\w+),/g)];
  assert.equal(routes.length, 4);
  for (const [, method, path, guard] of routes) {
    assert.equal(guard, "requireManager", `${method} ${path}`);
  }
});
