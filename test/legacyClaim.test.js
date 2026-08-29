import test from "node:test";
import assert from "node:assert/strict";

import { claimLegacyHangUpWithAutoStart } from "../src/utils/batch/tasksLegacy.js";

test("残卷可直接领取时不开始探索", async () => {
  const commands = [];
  const response = { reward: [{ value: 100 }] };

  const result = await claimLegacyHangUpWithAutoStart((command) => {
    commands.push(command);
    return Promise.resolve(response);
  });

  assert.equal(result, response);
  assert.deepEqual(commands, ["legacy_claimhangup"]);
});

test("领取失败但开始探索成功时重新领取", async () => {
  const commands = [];
  let claimCount = 0;
  let started = false;

  const result = await claimLegacyHangUpWithAutoStart(
    async (command) => {
      commands.push(command);
      if (command === "legacy_claimhangup" && claimCount++ === 0) {
        throw new Error("尚未开始探索");
      }
      return command === "legacy_beginhangup"
        ? { roleLegacy: {} }
        : { reward: [{ value: 100 }] };
    },
    () => {
      started = true;
    },
  );

  assert.equal(result.reward[0].value, 100);
  assert.equal(started, true);
  assert.deepEqual(commands, [
    "legacy_claimhangup",
    "legacy_beginhangup",
    "legacy_claimhangup",
  ]);
});

test("开始探索也失败时保留原领取错误", async () => {
  const claimError = new Error("原领取错误");
  let started = false;

  await assert.rejects(
    claimLegacyHangUpWithAutoStart(
      async (command) => {
        if (command === "legacy_claimhangup") throw claimError;
        throw new Error("开始探索失败");
      },
      () => {
        started = true;
      },
    ),
    (error) => error === claimError,
  );
  assert.equal(started, false);
});
