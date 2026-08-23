import test from "node:test";
import assert from "node:assert/strict";

import {
  RATE_LIMIT_MESSAGE,
  isRateLimitError,
  normalizeServerErrorDescription,
} from "../src/utils/serverError.js";

test("known rate-limit codes get a friendly explicit message", () => {
  assert.equal(normalizeServerErrorDescription(200400, "未知错误"), RATE_LIMIT_MESSAGE);
  assert.equal(normalizeServerErrorDescription(429, "Unknown"), RATE_LIMIT_MESSAGE);
});

test("explicit rate-limit hints get normalized", () => {
  assert.equal(normalizeServerErrorDescription(999999, "操作太快，请稍后再试"), RATE_LIMIT_MESSAGE);
  assert.equal(normalizeServerErrorDescription(999999, "Too Many Requests"), RATE_LIMIT_MESSAGE);
});

test("unknown and business errors are never guessed as rate limits", () => {
  assert.equal(normalizeServerErrorDescription(2100010, "未知错误"), "未知错误");
  assert.equal(normalizeServerErrorDescription(400010, "物品数量不足"), "物品数量不足");
  assert.equal(normalizeServerErrorDescription(200020, "出了点小问题"), "出了点小问题");
});

test("rate-limit detection is strict", () => {
  assert.equal(isRateLimitError(new Error("服务器错误: 429 - Unknown")), true);
  assert.equal(isRateLimitError(new Error("触发服务器限流（请求过于频繁）")), true);
  assert.equal(isRateLimitError(new Error("服务器错误: 2100010 - 未知错误")), false);
  assert.equal(isRateLimitError(new Error("WebSocket连接已关闭")), false);
});
