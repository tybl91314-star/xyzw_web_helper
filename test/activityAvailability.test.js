import test from "node:test";
import assert from "node:assert/strict";

import {
  isArenaActivityOpenAt,
  isCarActivityOpenAt,
  isDreamActivityOpenAt,
  isVaultActivityOpenAt,
  getActivityWeekAt,
  isWeirdTowerActivityOpenAt,
  isWeirdTowerMergeAvailableAt,
} from "../src/utils/batch/activityAvailability.js";

const localDate = (year, month, day, hour, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

test("智能发车只在周一到周三 06:00-20:00 开放", () => {
  assert.equal(isCarActivityOpenAt(localDate(2026, 8, 3, 5, 59)), false);
  assert.equal(isCarActivityOpenAt(localDate(2026, 8, 3, 6)), true);
  assert.equal(isCarActivityOpenAt(localDate(2026, 8, 5, 19, 59)), true);
  assert.equal(isCarActivityOpenAt(localDate(2026, 8, 5, 20)), false);
  assert.equal(isCarActivityOpenAt(localDate(2026, 8, 6, 12)), false);
});

test("其他按星期和小时开放的活动按传入时间重新判断", () => {
  assert.equal(isDreamActivityOpenAt(localDate(2026, 8, 3, 12)), true);
  assert.equal(isDreamActivityOpenAt(localDate(2026, 8, 4, 12)), false);
  assert.equal(isVaultActivityOpenAt(localDate(2026, 8, 3, 12)), false);
  assert.equal(isVaultActivityOpenAt(localDate(2026, 8, 5, 12)), true);
  assert.equal(isArenaActivityOpenAt(localDate(2026, 8, 3, 5, 59)), false);
  assert.equal(isArenaActivityOpenAt(localDate(2026, 8, 3, 6)), true);
  assert.equal(isArenaActivityOpenAt(localDate(2026, 8, 3, 22)), false);
});

test("怪异塔周四结束，但道具合成延续到周五11点前", () => {
  assert.equal(
    isWeirdTowerActivityOpenAt(localDate(2025, 12, 12, 11, 59)),
    false,
  );
  assert.equal(
    isWeirdTowerActivityOpenAt(localDate(2025, 12, 12, 12)),
    true,
  );
  const thursdayEnd = new Date(2025, 11, 18, 23, 59, 59);
  assert.equal(isWeirdTowerActivityOpenAt(thursdayEnd), true);
  assert.equal(isWeirdTowerMergeAvailableAt(thursdayEnd), true);
  assert.equal(
    isWeirdTowerActivityOpenAt(localDate(2025, 12, 19, 10, 59)),
    false,
  );
  assert.equal(
    isWeirdTowerMergeAvailableAt(localDate(2025, 12, 19, 10, 59)),
    true,
  );
  assert.equal(getActivityWeekAt(localDate(2025, 12, 19, 10, 59)), "黑市周");
  assert.equal(
    isWeirdTowerMergeAvailableAt(localDate(2025, 12, 19, 11)),
    false,
  );
  assert.equal(isWeirdTowerActivityOpenAt(localDate(2025, 12, 19, 12)), false);
});
