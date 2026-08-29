import test from "node:test";
import assert from "node:assert/strict";

import {
  createTasksStore,
  findWeeklyFreeStoreGoods,
} from "../src/utils/batch/tasksStore.js";

const createStorePurchaseHarness = ({
  roleData,
  purchaseError = null,
  marketState = null,
}) => {
  const logs = [];
  const commands = [];
  const tokenStatus = { value: {} };
  const roleResponses = Array.isArray(roleData) ? [...roleData] : [roleData];
  const tokenStore = {
    gameTokens: [{ id: "role-1", name: "测试账号" }],
    sendGetRoleInfo: async () => ({
      role: roleResponses.length > 1 ? roleResponses.shift() : roleResponses[0],
    }),
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

test("一键黑市购买先检查日常，已完成时不再发送黑市命令", async () => {
  const harness = createStorePurchaseHarness({
    roleData: { levelId: 3999, dailyTask: { complete: { 12: -1 } } },
    marketState: {
      goodsList: { 1: { buy_quantity: 1 }, 3: { buy_quantity: 1 } },
      refresh: 1,
    },
  });

  await harness.store_purchase();

  assert.deepEqual(harness.commands, []);
  assert.equal(harness.tokenStatus.value["role-1"], "completed");
  assert.ok(harness.logs.some(({ message }) => message.includes("已经完成")));
});

test("一键黑市购买与日常共用清单失败后复查并兜底的逻辑", async () => {
  const harness = createStorePurchaseHarness({
    roleData: [
      { levelId: 4000, dailyTask: { complete: { 12: 0 } } },
      { levelId: 4000, dailyTask: { complete: { 12: 0 } } },
    ],
    marketState: {
      goodsList: { 1: { buy_quantity: 0 }, 3: { buy_quantity: 0 } },
      refresh: 0,
    },
    purchaseError: new Error("服务器错误: 1300040 - 未知错误"),
  });

  await harness.store_purchase();

  assert.deepEqual(harness.commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
    { command: "store_purchase", params: {} },
    { command: "store_buy", params: { goodsId: 1 } },
  ]);
  assert.equal(harness.tokenStatus.value["role-1"], "completed");
  assert.ok(harness.logs.some(({ message }) => message.includes("青铜宝箱")));
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
