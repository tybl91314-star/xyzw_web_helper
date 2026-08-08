import test from "node:test";
import assert from "node:assert/strict";

import {
  getClaimableLegacyGiftTaskIds,
  getLegacyGiftRemainingLimit,
  getLegacyGiftTarget,
  isLegacyGiftRateLimitError,
  parseLegacyGiftWan,
} from "../src/utils/batch/legacyGift.js";

test("指定赠送数量按万换算，最多一位小数且不超过100万", () => {
  assert.equal(parseLegacyGiftWan(0.1), 1000);
  assert.equal(parseLegacyGiftWan(2.5), 25000);
  assert.equal(parseLegacyGiftWan(100), 1000000);
  assert.throws(() => parseLegacyGiftWan(0));
  assert.throws(() => parseLegacyGiftWan(100.1));
  assert.throws(() => parseLegacyGiftWan(1.23));
});

test("所有按库存赠送，指定数量不超过库存", () => {
  assert.equal(getLegacyGiftTarget({ mode: "all", inventory: 23567 }), 23567);
  assert.equal(
    getLegacyGiftTarget({ mode: "specific", quantityWan: 3, inventory: 20000 }),
    20000,
  );
});

test("从功法任务进度中找出可尝试领取的任务", () => {
  assert.deepEqual(
    getClaimableLegacyGiftTaskIds({
      giftTask: { 101: 1, 102: 2, 103: 0, 104: 3 },
      giftTaskClaim: { 101: 1, 102: 1, 104: 3 },
    }),
    [102],
  );
});

test("识别功法赠送操作过快错误", () => {
  assert.equal(
    isLegacyGiftRateLimitError(new Error("服务器错误: 400312 - 未知错误")),
    true,
  );
  assert.equal(isLegacyGiftRateLimitError("操作过快，请稍后重试"), true);
  assert.equal(isLegacyGiftRateLimitError("赠送额度不足"), false);
});

test("按VIP、已领取任务和今日已赠数量计算剩余额度", () => {
  const now = new Date(2026, 7, 5, 12, 0, 0).getTime();
  const resetTime = Math.floor(new Date(2026, 7, 5, 8, 0, 0).getTime() / 1000);
  assert.equal(
    getLegacyGiftRemainingLimit({
      role: { vip: 5 },
      roleLegacy: {
        giftTaskClaim: { 1: 1, 4: 1 },
        sendItemCnt: 240,
        sendGiftResetTime: resetTime,
      },
      now,
    }),
    1060,
  );
});

test("跨日后不扣除旧的已赠数量，特权账号不限制额度", () => {
  const now = new Date(2026, 7, 5, 12, 0, 0).getTime();
  const yesterday = Math.floor(
    new Date(2026, 7, 4, 23, 0, 0).getTime() / 1000,
  );
  assert.equal(
    getLegacyGiftRemainingLimit({
      role: { vip: 6 },
      roleLegacy: { sendItemCnt: 600, sendGiftResetTime: yesterday },
      now,
    }),
    600,
  );
  assert.equal(
    getLegacyGiftRemainingLimit({
      role: { vip: 0, privilege: { 501: 0 } },
      roleLegacy: {},
      now,
    }),
    Number.MAX_SAFE_INTEGER,
  );
});
