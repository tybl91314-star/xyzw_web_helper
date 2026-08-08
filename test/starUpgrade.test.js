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

test("操作过快或连接异常会停止该账号后续升星", async () => {
  assert.equal(
    shouldAbortStarUpgrade(new Error("服务器错误: 200400 - 操作太快")),
    true,
  );
  assert.equal(shouldAbortStarUpgrade(new Error("WebSocket连接已关闭")), true);
  assert.equal(shouldAbortStarUpgrade(new Error("材料不足")), false);
});
