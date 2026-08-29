import test from "node:test";
import assert from "node:assert/strict";

import {
  createTasksStore,
  findWeeklyFreeStoreGoods,
  isNoPurchasableStoreGoodsError,
} from "../src/utils/batch/tasksStore.js";

const createStorePurchaseHarness = ({
  roleData,
  purchaseError = null,
  marketState = null,
}) => {
  const logs = [];
  const commands = [];
  const tokenStatus = { value: {} };
  const tokenStore = {
    gameTokens: [{ id: "role-1", name: "测试账号" }],
    sendGetRoleInfo: async () => ({ role: roleData }),
    sendMessageWithPromise: async (_tokenId, command, params) => {
      commands.push({ command, params });
      if (command === "store_goodslist") return marketState;
      if (command === "store_purchase" && purchaseError) throw purchaseError;
      return {};
    },
    closeWebSocketConnection: () => {},
  };
  const tasks = createTasksStore({
    selectedTokens: { value: ["role-1"] },
    tokens: { value: tokenStore.gameTokens },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 8 },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: {},
    currentRunningTokenId: { value: null },
    delayConfig: { action: 0 },
  });
  return { ...tasks, commands, logs, tokenStatus };
};

test("识别黑市没有可采购商品错误码", () => {
  assert.equal(
    isNoPurchasableStoreGoodsError(
      new Error("服务器错误: 1300040 - 未知错误"),
    ),
    true,
  );
  assert.equal(isNoPurchasableStoreGoodsError(new Error("连接超时")), false);
});

test("4000级以下按服务器黑市状态确认已买后直接返回成功", async () => {
  const harness = createStorePurchaseHarness({
    roleData: { levelId: 3999, dailyTask: { complete: { 12: -1 } } },
    marketState: {
      goodsList: { 1: { buy_quantity: 1 }, 3: { buy_quantity: 1 } },
      refresh: 1,
    },
  });

  await harness.store_purchase();

  assert.deepEqual(harness.commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
  ]);
  assert.equal(harness.tokenStatus.value["role-1"], "completed");
  assert.ok(harness.logs.some(({ message }) => message.includes("当前刷新1次")));
});

test("清单采购已满足时1300040按成功处理", async () => {
  const harness = createStorePurchaseHarness({
    roleData: { levelId: 4000, dailyTask: { complete: { 12: -1 } } },
    purchaseError: new Error("服务器错误: 1300040 - 未知错误"),
  });

  await harness.store_purchase();

  assert.deepEqual(harness.commands, [
    { command: "store_purchase", params: {} },
  ]);
  assert.equal(harness.tokenStatus.value["role-1"], "completed");
  assert.ok(
    harness.logs.some(({ message }) => message.includes("没有可采购商品")),
  );
});

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
