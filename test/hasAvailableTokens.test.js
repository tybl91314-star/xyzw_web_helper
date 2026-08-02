import assert from "node:assert/strict";
import test from "node:test";

import { hasAvailableTokens } from "../src/utils/hasAvailableTokens.js";

test("hasAvailableTokens detects Pinia-unwrapped token arrays", () => {
  assert.equal(hasAvailableTokens({ gameTokens: [{ id: "role-1" }] }), true);
});

test("hasAvailableTokens detects ref-shaped token arrays", () => {
  assert.equal(
    hasAvailableTokens({ gameTokens: { value: [{ id: "role-1" }] } }),
    true,
  );
});

test("hasAvailableTokens rejects empty token stores", () => {
  assert.equal(hasAvailableTokens({ gameTokens: [] }), false);
});
