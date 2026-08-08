import test from "node:test";
import assert from "node:assert/strict";

import { findWeeklyFreeStoreGoods } from "../src/utils/batch/tasksStore.js";

test("从当前限时商店动态识别唯一免费档位", () => {
  const result = {
    activity: {
      activity: [
        {
          id: 6,
          type: 4,
          name: "限时商店",
          data: {
            goodsList: [
              { title: "招募福利", price: 0 },
              { title: "招募必买", price: 3000 },
            ],
          },
        },
      ],
      myStoreInfo: { 6: { complete: {} } },
    },
  };

  assert.deepEqual(findWeeklyFreeStoreGoods(result), [
    {
      activityId: 6,
      goodsIndex: 0,
      title: "招募福利",
      claimed: false,
    },
  ]);
});

test("适配不同周活动编号、非首位免费档以及已领取状态", () => {
  const result = {
    body: {
      activity: {
        activity: [
          {
            id: 12,
            type: 4,
            name: "限时商店",
            data: {
              goodsList: [
                { title: "付费宝箱", price: 648 },
                { title: "宝箱福利", price: 0 },
              ],
            },
          },
          {
            id: 99,
            type: 1,
            name: "其他活动",
            data: { goodsList: [{ title: "不是限时商店", price: 0 }] },
          },
        ],
        myStoreInfo: { 12: { complete: { 1: 1 } } },
      },
    },
  };

  assert.deepEqual(findWeeklyFreeStoreGoods(result), [
    {
      activityId: 12,
      goodsIndex: 1,
      title: "宝箱福利",
      claimed: true,
    },
  ]);
});

test("没有当前限时商店时返回空数组", () => {
  assert.deepEqual(findWeeklyFreeStoreGoods({ activity: {} }), []);
});
