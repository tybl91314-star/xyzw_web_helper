import test from "node:test";
import assert from "node:assert/strict";

import { availableTasks } from "../src/utils/batch/constants.js";

const taskMap = new Map(
  availableTasks.map((task) => [task.value, task.label]),
);

test("定时任务包含可安全自动执行的升星、图鉴奖励和皮肤币功能", () => {
  assert.equal(taskMap.get("batchHeroUpgrade"), "一键英雄升星");
  assert.equal(taskMap.get("batchFishSpiritUpgrade"), "一键鱼灵升星");
  assert.equal(taskMap.get("batchBookUpgrade"), "一键图鉴升星");
  assert.equal(taskMap.get("batchClaimStarRewards"), "一键领取图鉴奖励");
  assert.equal(
    taskMap.get("legionStoreBuySkinCoins"),
    "一键购买俱乐部5皮肤币",
  );
});

test("需要人工选择目标的竞猜功能不进入定时任务", () => {
  assert.equal(taskMap.has("batchFootballBet"), false);
  assert.equal(taskMap.has("openWarGuessModal"), false);
});

test("定时任务与手动批量功能使用统一名称", () => {
  assert.equal(taskMap.get("collection_claimfreereward"), "一键领取珍宝阁");
  assert.equal(taskMap.get("batchGenieSweep"), "一键灯神扫荡");
  assert.equal(taskMap.get("batchLegacyClaim"), "批量功法残卷领取");
  assert.equal(
    taskMap.get("batchLegacyGiftSendEnhanced"),
    "批量功法残卷赠送",
  );
});
