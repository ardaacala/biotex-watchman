import assert from "node:assert/strict";
import test from "node:test";
import { isNewVersion } from "./app-version.ts";

test("only a valid different release triggers the update banner", () => {
  assert.equal(isNewVersion({ version: "new" }, "current"), true);
  for (const value of [null, undefined, "", {}, { version: "" }, { version: " " }, { version: 1 }, { version: "current" }]) {
    assert.equal(isNewVersion(value, "current"), false);
  }
});