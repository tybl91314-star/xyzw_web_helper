import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldAbortStarUpgrade,
  upgradeStarUntilBlocked,
} from "../src/utils/batch/starUpgrade.js";

test("升星不再受10次上限限制，直到服务端明确拒绝", async () => {
  let calls = 0;
  const result = await upgradeStarUntilBlocked({
    sendUpgrade: async () => {
      calls++;
      if (calls > 15) throw new Error("材料不足");
    },
  });

  assert.equal(result.upgraded, 15);
  assert.equal(calls, 16);
  assert.equal(result.abortAccount, false);
});

test("操作过快或连接异常属于账号级异常", async () => {
  assert.equal(
    shouldAbortStarUpgrade(new Error("服务器错误: 200400 - 操作太快")),
    true,
  );
  assert.equal(shouldAbortStarUpgrade(new Error("WebSocket连接已关闭")), true);
  assert.equal(shouldAbortStarUpgrade(new Error("材料不足")), false);
});

test("临时限流会退避重试，成功后继续升到材料不足", async () => {
  let calls = 0;
  const retryDelays = [];
  const result = await upgradeStarUntilBlocked({
    sendUpgrade: async () => {
      calls++;
      if (calls === 1 || calls === 3) {
        throw new Error("服务器错误: 200400 - 操作太快");
      }
      if (calls > 4) throw new Error("材料不足");
    },
    onRetry: (_error, _retryCount, delay) => retryDelays.push(delay),
    waitBeforeRetry: async () => {},
  });

  assert.equal(result.upgraded, 2);
  assert.equal(calls, 5);
  assert.deepEqual(retryDelays, [1200, 1200]);
  assert.equal(result.abortAccount, false);
});

test("连续限流超过重试次数才停止该账号", async () => {
  let calls = 0;
  const result = await upgradeStarUntilBlocked({
    sendUpgrade: async () => {
      calls++;
      throw new Error("操作过快");
    },
    waitBeforeRetry: async () => {},
    maxRetries: 2,
  });

  assert.equal(calls, 3);
  assert.equal(result.upgraded, 0);
  assert.equal(result.abortAccount, true);
});
