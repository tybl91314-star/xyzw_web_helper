import test from "node:test";
import assert from "node:assert/strict";

import { findSkinChallengeSupplyActivityId } from "../src/utils/batch/tasksTower.js";

test("根据换皮闯关主活动动态定位相邻的赛场补给活动", () => {
  const result = {
    activity: {
      commonActivityInfo: {
        2608073: { record: {}, task: {}, isBought: false },
        2608074: { record: {}, task: {}, isBought: false },
      },
      actEGameInfo: { actId: 2608072 },
    },
  };

  assert.equal(findSkinChallengeSupplyActivityId(result), 2608073);
});

test("活动日期编号变化后仍按实时主活动定位", () => {
  const result = {
    body: {
      activity: {
        commonActivityInfo: {
          2611053: { record: {}, task: {}, isBought: false },
          2611054: { record: {}, task: {}, isBought: false },
        },
        actEGameInfo: { actId: 2611052 },
      },
    },
  };

  assert.equal(findSkinChallengeSupplyActivityId(result), 2611053);
});

test("没有主活动或可识别补给活动时不尝试领取", () => {
  assert.equal(findSkinChallengeSupplyActivityId({ activity: {} }), null);
});
