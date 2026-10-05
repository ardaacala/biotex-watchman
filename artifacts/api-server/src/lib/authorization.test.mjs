import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireManager, requireWorkforceEditor } from "./authorization.ts";

function runGuard(guard, user) {
  const result = { allowed: false, status: null };
  const res = {
    locals: { user },
    status(code) { result.status = code; return this; },
    json() { return this; },
  };
  guard({}, res, () => { result.allowed = true; });
  return result;
}

for (const role of ["manager", "hr"]) {
  test(`approved ${role} can perform workforce operations`, () => {
    assert.equal(runGuard(requireWorkforceEditor, { role, approvalStatus: "approved" }).allowed, true);
  });
  for (const approvalStatus of ["pending", "rejected"]) {
    test(`${approvalStatus} ${role} cannot perform workforce operations`, () => {
      assert.deepEqual(runGuard(requireWorkforceEditor, { role, approvalStatus }), { allowed: false, status: 403 });
    });
  }
}

test("only approved managers can approve memberships or create departments", () => {
  assert.equal(runGuard(requireManager, { role: "manager", approvalStatus: "approved" }).allowed, true);
  for (const user of [
    { role: "hr", approvalStatus: "approved" },
    { role: "manager", approvalStatus: "pending" },
    { role: "viewer", approvalStatus: "approved" },
    undefined,
  ]) {
    assert.deepEqual(runGuard(requireManager, user), { allowed: false, status: 403 });
  }
});

test("workforce writes reject missing or unsupported identities", () => {
  for (const user of [undefined, null, { role: "viewer", approvalStatus: "approved" }]) {
    assert.deepEqual(runGuard(requireWorkforceEditor, user), { allowed: false, status: 403 });
  }
});

test("all operational mutation routes use the HR-capable guard", () => {
  for (const filename of ["workforce.ts", "overtime.ts", "storage.ts"]) {
    const source = readFileSync(new URL(`../routes/${filename}`, import.meta.url), "utf8");
    const routes = [...source.matchAll(/router\.(post|put|patch|delete)\("([^"]+)",\s*(\w+),/g)];
    assert.ok(routes.length > 0);
    for (const [, method, path, guard] of routes) {
      const expected = filename === "workforce.ts" && method === "post" && path === "/departments"
        ? "requireManager"
        : "requireWorkforceEditor";
      assert.equal(guard, expected, `${method.toUpperCase()} ${path}`);
    }
  }
  const source = readFileSync(new URL("../routes/memberships.ts", import.meta.url), "utf8");
  assert.match(source, /router\.get\("\/membership-requests", requireManager,/);
  assert.match(source, /router\.patch\("\/membership-requests\/:id", requireManager,/);
});

test("department edits produce a supported activity type", () => {
  const spec = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");
  const activity = spec.slice(spec.indexOf("    Activity:"));
  const types = activity.match(/enum:\s*\[([^\]]+)\]/)?.[1].split(",").map((value) => value.trim());
  assert.ok(types?.includes("department"));
});