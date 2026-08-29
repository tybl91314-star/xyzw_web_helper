import test from "node:test";
import assert from "node:assert/strict";

import {
  BLACK_MARKET_DAILY_TASK_ID,
  BRONZE_CHEST_GOODS_ID,
  PLATINUM_CHEST_GOODS_ID,
  STORE_PURCHASE_UNLOCK_LEVEL,
  DAILY_ACTIVITY_TARGET,
  DailyTaskRunner,
  FINAL_REWARD_TASKS,
  canUseStorePurchaseList,
  getDailyActivityPoint,
  getBlackMarketBuyQuantity,
  getRemainingLegionBossFights,
  isDailyActivityComplete,
  parseBlackMarketState,
} from "../src/utils/dailyTaskRunner.js";

const marketState = (refresh, bronze = 0, platinum = 0) => ({
  goodsList: {
    1: { buy_quantity: bronze, discount: 0.5 },
    3: { buy_quantity: platinum, discount: 0.8 },
  },
  refresh,
});

test("解析服务器黑市刷新次数和当前商品购买数量", () => {
  const state = parseBlackMarketState({
    _raw: { body: marketState(1, 1, 1) },
  });

  assert.equal(state.refresh, 1);
  assert.equal(getBlackMarketBuyQuantity(state, 1), 1);
  assert.equal(getBlackMarketBuyQuantity(state, 3), 1);
  assert.equal(getBlackMarketBuyQuantity(state, 16), 0);
});

test("只有达到4000级的账号才使用黑市清单采购", () => {
  assert.equal(STORE_PURCHASE_UNLOCK_LEVEL, 4000);
  assert.equal(canUseStorePurchaseList({ levelId: 3999 }), false);
  assert.equal(canUseStorePurchaseList({ levelId: 4000 }), true);
  assert.equal(canUseStorePurchaseList({ levelId: 5000 }), true);
  assert.equal(canUseStorePurchaseList({}), true);
});

test("4000级以下按青铜铂金刷新青铜铂金的顺序购买", async () => {
  const commands = [];
  const states = [marketState(0), marketState(1)];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_goodslist") return states.shift();
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-low-level", {
    levelId: 3999,
  });

  assert.deepEqual(result, {
    lowLevelFlow: true,
    completed: true,
    firstRoundPurchased: true,
    refreshed: true,
    refreshCount: 1,
  });
  assert.deepEqual(commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
    { command: "store_buy", params: { goodsId: BRONZE_CHEST_GOODS_ID } },
    { command: "store_buy", params: { goodsId: PLATINUM_CHEST_GOODS_ID } },
    { command: "store_refresh", params: { storeId: 1 } },
    { command: "store_goodslist", params: { storeId: 1 } },
    { command: "store_buy", params: { goodsId: BRONZE_CHEST_GOODS_ID } },
    { command: "store_buy", params: { goodsId: PLATINUM_CHEST_GOODS_ID } },
  ]);
});

test("低等级首轮宝箱都未买成功时不刷新黑市", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_goodslist") return marketState(0);
        throw new Error("金砖不足");
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  await assert.rejects(
    runner.purchaseBlackMarketDailyItem("role-low-level", {
      levelId: 3999,
    }),
    /未全部购买成功/,
  );
  assert.deepEqual(commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
    { command: "store_buy", params: { goodsId: BRONZE_CHEST_GOODS_ID } },
    { command: "store_buy", params: { goodsId: PLATINUM_CHEST_GOODS_ID } },
  ]);
});

test("低等级账号以服务器状态判断已刷新且已购买时不重复操作", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        return marketState(1, 1, 1);
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-low-level", {
    levelId: 3999,
  });

  assert.deepEqual(result, {
    lowLevelFlow: true,
    completed: true,
    firstRoundPurchased: true,
    refreshed: false,
    refreshCount: 1,
  });
  assert.deepEqual(commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
  ]);
});

test("黑市清单未购得商品时补买200金砖青铜宝箱", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-market", name: "黑市测试账号" }],
      sendGetRoleInfo: async () => ({
        role: { dailyTask: { complete: { [BLACK_MARKET_DAILY_TASK_ID]: 0 } } },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-market");

  assert.deepEqual(result, { fallbackPurchased: true });
  assert.deepEqual(commands, [
    { command: "store_purchase", params: {} },
    {
      command: "store_buy",
      params: { goodsId: BRONZE_CHEST_GOODS_ID },
    },
  ]);
});

test("黑市清单已完成购买任务时不再补买青铜宝箱", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-market", name: "黑市测试账号" }],
      sendGetRoleInfo: async () => ({
        role: { dailyTask: { complete: { [BLACK_MARKET_DAILY_TASK_ID]: -1 } } },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-market");

  assert.deepEqual(result, { fallbackPurchased: false });
  assert.deepEqual(commands, [{ command: "store_purchase", params: {} }]);
});

test("清单采购接口不可用时仍复查任务并补买青铜宝箱", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendGetRoleInfo: async () => ({
        role: { dailyTask: { complete: { [BLACK_MARKET_DAILY_TASK_ID]: 0 } } },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_purchase") {
          throw new Error("功能未解锁");
        }
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-low-level");

  assert.deepEqual(result, { fallbackPurchased: true });
  assert.deepEqual(commands, [
    { command: "store_purchase", params: {} },
    {
      command: "store_buy",
      params: { goodsId: BRONZE_CHEST_GOODS_ID },
    },
  ]);
});

test("无法准确刷新黑市任务状态时不执行兜底购买", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-refresh-failed", name: "刷新失败账号" }],
      sendGetRoleInfo: async () => {
        throw new Error("角色信息请求超时");
      },
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  await assert.rejects(
    runner.purchaseBlackMarketDailyItem("role-refresh-failed"),
    /为避免重复购买已停止兜底/,
  );
  assert.deepEqual(commands, [{ command: "store_purchase", params: {} }]);
});

test("每日活跃达到或超过100时视为已完成", () => {
  assert.equal(DAILY_ACTIVITY_TARGET, 100);
  assert.equal(isDailyActivityComplete({ dailyTask: { dailyPoint: 99 } }), false);
  assert.equal(isDailyActivityComplete({ dailyTask: { dailyPoint: 100 } }), true);
  assert.equal(isDailyActivityComplete({ dailyTask: { dailyPoint: 120 } }), true);
  assert.equal(isDailyActivityComplete({ dailyTask: { dailyPoint: "100" } }), true);
  assert.equal(getDailyActivityPoint({}), 0);
});

test("每日活跃奖励固定为批量日常的最后一个领取任务", () => {
  assert.equal(FINAL_REWARD_TASKS.at(-1).command, "task_claimdailyreward");
  assert.deepEqual(
    FINAL_REWARD_TASKS.map((task) => task.command),
    [
      "task_claimweekreward",
      "activity_recyclewarorderrewardclaim",
      "task_claimdailyreward",
    ],
  );
});

test("批量日常开始时活跃已满则不发送任何任务命令", async () => {
  const commands = [];
  const progress = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-1", name: "测试账号" }],
      sendGetRoleInfo: async () => ({
        role: { dailyTask: { dailyPoint: 100 } },
      }),
      sendMessageWithPromise: async (_tokenId, command) => {
        commands.push(command);
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.run(
    "role-1",
    { onProgress: (value) => progress.push(value) },
    {},
  );

  assert.deepEqual(result, { skipped: true, dailyPoint: 100 });
  assert.deepEqual(commands, []);
  assert.deepEqual(progress, [100]);
});

test("俱乐部BOSS按今日已打次数补到设置目标", () => {
  assert.equal(getRemainingLegionBossFights(2, 0, true), 2);
  assert.equal(getRemainingLegionBossFights(2, 1, true), 1);
  assert.equal(getRemainingLegionBossFights(2, 2, true), 0);
  assert.equal(getRemainingLegionBossFights(2, 3, true), 0);
  assert.equal(getRemainingLegionBossFights(2, 2, false), 2);
  assert.equal(getRemainingLegionBossFights(0, 0, true), 0);
});

test("全部BOSS战斗结束后最后切回竞技场阵容", async () => {
  const commands = [];
  const completedTasks = Object.fromEntries(
    Array.from({ length: 14 }, (_, index) => [index + 1, -1]),
  );
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-2", name: "阵容测试账号" }],
      sendGetRoleInfo: async () => ({
        role: {
          dailyTask: { dailyPoint: 0, complete: completedTasks },
          statistics: { "legion:boss": 0 },
          statisticsTime: {},
        },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "presetteam_getinfo") {
          return { presetTeamInfo: { useTeamId: 1 } };
        }
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  await runner.run(
    "role-2",
    {},
    {
      arenaFormation: 3,
      bossFormation: 2,
      bossTimes: 1,
      arenaEnable: false,
      claimBottle: false,
      payRecruit: false,
      openBox: false,
      claimHangUp: false,
      claimEmail: false,
      blackMarketPurchase: false,
      freeGachaEnable: false,
    },
  );

  const formationChanges = commands.filter(
    ({ command }) => command === "presetteam_saveteam",
  );
  assert.deepEqual(formationChanges.at(-1)?.params, { teamId: 3 });
  assert.equal(
    commands.filter(({ command }) => command === "fight_startlegionboss")
      .length,
    1,
  );
  assert.ok(
    commands.findLastIndex(({ command }) => command === "presetteam_saveteam") >
      commands.findLastIndex(({ command }) => command === "fight_startboss"),
  );
});
