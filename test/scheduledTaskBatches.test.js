import test from "node:test";
import assert from "node:assert/strict";

import {
  createAccountBatches,
  getBatchIntervalMs,
} from "../src/utils/batch/scheduledTaskBatches.js";

test("50 accounts are split into unique 12-account batches", () => {
  const accounts = Array.from({ length: 50 }, (_, index) => `token-${index + 1}`);
  const batches = createAccountBatches(accounts, 12);

  assert.deepEqual(batches.map((batch) => batch.length), [12, 12, 12, 12, 2]);
  assert.deepEqual(batches.flat(), accounts);
  assert.equal(new Set(batches.flat()).size, 50);
});

test("duplicate account ids are only scheduled once", () => {
  assert.deepEqual(createAccountBatches(["a", "b", "a", "c"], 2), [
    ["a", "b"],
    ["c"],
  ]);
});

test("interval minutes are converted to milliseconds", () => {
  assert.equal(getBatchIntervalMs(1), 60_000);
  assert.equal(getBatchIntervalMs(0.5), 30_000);
  assert.equal(getBatchIntervalMs(-1), 0);
});
