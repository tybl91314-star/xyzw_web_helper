import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bonProtocol } from "../src/utils/bonProtocol.js";
import { createAccountTaskQueue } from "../src/utils/batch/accountTaskQueue.js";

import {
  BLACK_MARKET_DAILY_TASK_ID,
  BRONZE_CHEST_GOODS_ID,
  PLATINUM_CHEST_GOODS_ID,
  STORE_PURCHASE_UNLOCK_LEVEL,
  DAILY_ACTIVITY_TARGET,
  DAILY_TASK_TARGETS,
  DAILY_TASK_REWARD_IDS,
  DailyTaskRunner,
  FINAL_REWARD_TASKS,
  canUseStorePurchaseList,
  getDailyActivityPoint,
  getClaimableDailyTaskIds,
  getBlackMarketBuyQuantity,
  getRemainingLegionBossFights,
  isBlackMarketDailyTaskCompleted,
  isDailyActivityComplete,
  parseBlackMarketState,
} from "../src/utils/dailyTaskRunner.js";

// 独立摘录自 AI之王所带游戏客户端的 DailyTaskConf（配置资源
// config/import/26/26a3f138-2ad4-4bf6-a00a-fee2d2544281.f42c3.json）。
// 模拟服务器必须依据此配置，不能从被测代码反向生成协议预期。
const clientDailyTaskConfig = JSON.parse(
  readFileSync(new URL("./fixtures/dailyTaskConfig.json", import.meta.url), "utf8"),
);
const clientTaskById = new Map(clientDailyTaskConfig.map((task) => [task.id, task]));

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

test("兼容批量入口的rawData包装和未解码BON响应", () => {
  const expected = marketState(1, 1, 1);

  assert.deepEqual(parseBlackMarketState({ rawData: expected }), expected);
  assert.deepEqual(
    parseBlackMarketState({ _raw: { decodedBody: expected } }),
    expected,
  );
  assert.deepEqual(
    parseBlackMarketState({ _raw: { body: bonProtocol.encode(expected) } }),
    expected,
  );
});

test("服务器省略默认值时按黑市未刷新处理", () => {
  const state = parseBlackMarketState({
    goodsList: {
      1: { buy_quantity: 0, discount: 0.5 },
      3: { buy_quantity: 0, discount: 0.8 },
    },
  });

  assert.equal(state.refresh, 0);
  assert.equal(getBlackMarketBuyQuantity(state, 1), 0);
  assert.equal(getBlackMarketBuyQuantity(state, 3), 0);
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
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendGetRoleInfo: async () => ({
        role: { levelId: 3999, dailyTask: { complete: { 12: 0 } } },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_goodslist") return marketState(0);
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
    { command: "store_buy", params: { goodsId: BRONZE_CHEST_GOODS_ID } },
    { command: "store_buy", params: { goodsId: PLATINUM_CHEST_GOODS_ID } },
  ]);
});

test("低等级首轮宝箱都未买成功时不刷新黑市", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendGetRoleInfo: async () => ({
        role: { levelId: 3999, dailyTask: { complete: { 12: 0 } } },
      }),
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

test("黑市日常已完成时不分等级直接结束", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendGetRoleInfo: async () => ({
        role: { levelId: 3999, dailyTask: { complete: { 12: -1 } } },
      }),
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
    dailyTaskCompleted: true,
    skipped: true,
  });
  assert.deepEqual(commands, []);
});

test("黑市日常已完成待领取时也直接结束", async () => {
  assert.equal(
    isBlackMarketDailyTaskCompleted({ dailyTask: { complete: { 12: 0 } } }),
    false,
  );
  assert.equal(
    isBlackMarketDailyTaskCompleted({ dailyTask: { complete: { 12: 1 } } }),
    true,
  );
  assert.equal(
    isBlackMarketDailyTaskCompleted({ dailyTask: { complete: { 12: -1 } } }),
    true,
  );

  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-market", name: "待领取账号" }],
      sendGetRoleInfo: async () => ({
        role: { levelId: 4000, dailyTask: { complete: { 12: 1 } } },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  assert.deepEqual(await runner.purchaseBlackMarketDailyItem("role-market"), {
    dailyTaskCompleted: true,
    skipped: true,
  });
  assert.deepEqual(commands, []);
});

test("黑市清单未购得商品时补买200金砖青铜宝箱", async () => {
  const commands = [];
  const roleStates = [0, 0];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-market", name: "黑市测试账号" }],
      sendGetRoleInfo: async () => ({
        role: {
          levelId: 4000,
          dailyTask: { complete: { [BLACK_MARKET_DAILY_TASK_ID]: roleStates.shift() } },
        },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_goodslist") return marketState(0);
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-market");

  assert.deepEqual(result, {
    dailyTaskCompleted: false,
    purchaseListExecuted: true,
    fallbackPurchased: true,
    refreshCount: 0,
  });
  assert.deepEqual(commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
    { command: "store_purchase", params: {} },
    {
      command: "store_buy",
      params: { goodsId: BRONZE_CHEST_GOODS_ID },
    },
  ]);
});

test("清单采购成功后任务待领取时不再补买青铜宝箱", async () => {
  const commands = [];
  const roleStates = [0, 1];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-market", name: "黑市测试账号" }],
      sendGetRoleInfo: async () => ({
        role: {
          levelId: 4000,
          dailyTask: { complete: { [BLACK_MARKET_DAILY_TASK_ID]: roleStates.shift() } },
        },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_goodslist") return marketState(0);
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-market");

  assert.deepEqual(result, {
    dailyTaskCompleted: true,
    purchaseListExecuted: true,
    fallbackPurchased: false,
    refreshCount: 0,
  });
  assert.deepEqual(commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
    { command: "store_purchase", params: {} },
  ]);
});

test("4000级以上已刷新过时跳过清单采购并直接买青铜宝箱", async () => {
  const commands = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-market", name: "黑市测试账号" }],
      sendGetRoleInfo: async () => ({
        role: { levelId: 4000, dailyTask: { complete: { 12: 0 } } },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_goodslist") return marketState(1);
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-market");

  assert.equal(result.refreshCount, 1);
  assert.equal(result.fallbackPurchased, true);
  assert.deepEqual(commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
    { command: "store_buy", params: { goodsId: BRONZE_CHEST_GOODS_ID } },
  ]);
});

test("清单采购接口不可用时仍复查任务并补买青铜宝箱", async () => {
  const commands = [];
  const roleStates = [0, 0];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "role-low-level", name: "低等级账号" }],
      sendGetRoleInfo: async () => ({
        role: {
          levelId: 4000,
          dailyTask: { complete: { [BLACK_MARKET_DAILY_TASK_ID]: roleStates.shift() } },
        },
      }),
      sendMessageWithPromise: async (_tokenId, command, params) => {
        commands.push({ command, params });
        if (command === "store_goodslist") return marketState(0);
        if (command === "store_purchase") {
          throw new Error("功能未解锁");
        }
        return {};
      },
    },
    { commandDelay: 0, taskDelay: 0 },
  );

  const result = await runner.purchaseBlackMarketDailyItem("role-low-level");

  assert.equal(result.fallbackPurchased, true);
  assert.deepEqual(commands, [
    { command: "store_goodslist", params: { storeId: 1 } },
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
    /无法读取黑市日常任务状态/,
  );
  assert.deepEqual(commands, []);
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
          dailyTask: {
            dailyPoint: commands.some(({ command }) => command === "task_claimdailyreward") ? 100 : 0,
            complete: completedTasks,
          },
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

test("按进度类型识别任务，返回领取ID而不是进度类型", () => {
  assert.deepEqual(getClaimableDailyTaskIds({
    dailyTask: { complete: { 1: 1, 2: -1, 3: 2, 4: 1, 5: 5, 12: 1, 13: 1, 14: 1 } },
  }), [1, 5, 8, 9, 10]);
  for (const task of clientDailyTaskConfig) {
    assert.equal(DAILY_TASK_TARGETS[task.completeCondition], task.completeValue);
    assert.equal(DAILY_TASK_REWARD_IDS[task.completeCondition], task.id);
    assert.deepEqual(getClaimableDailyTaskIds({
      dailyTask: { complete: { [task.completeCondition]: task.completeValue } },
    }), [task.id]);
  }
});

const noExtraDailyActions = {
  bossTimes: 0, arenaEnable: false, claimBottle: false, payRecruit: false,
  openBox: false, claimHangUp: false, claimEmail: false, blackMarketPurchase: false,
  freeGachaEnable: false,
};

function dailyClaimFixture({ failClaim = false, failAction = false, noRewards = false } = {}) {
  const role = {
    dailyTask: {
      dailyPoint: 0,
      complete: Object.fromEntries(clientDailyTaskConfig.map(
        (task) => [task.completeCondition, task.completeValue],
      )),
    },
    statistics: {}, statisticsTime: {},
  };
  const commands = [];
  const logs = [];
  const runner = new DailyTaskRunner({
    gameTokens: [{ id: "A", name: "测试" }],
    sendGetRoleInfo: async () => ({ role: structuredClone(role) }),
    sendMessageWithPromise: async (_id, command, params) => {
      commands.push({ command, params });
      if (command === "task_claimdailypoint") {
        if (failClaim) throw new Error("领取失败");
        const task = clientTaskById.get(params.taskId);
        if (!task) throw new Error(`领取接口不接受 taskId=${params.taskId}`);
        if (role.dailyTask.complete[task.completeCondition] < task.completeValue) {
          throw new Error("任务未完成或已领取");
        }
        role.dailyTask.complete[task.completeCondition] = -1;
        role.dailyTask.dailyPoint += task.rewardPoints;
      }
      if (noRewards && FINAL_REWARD_TASKS.some((task) => task.command === command)) {
        throw new Error("服务器错误: 3500020 - 没有可领取的奖励");
      }
      if (failAction && command === "legion_signin") throw new Error("签到失败");
      return {};
    },
  }, { commandDelay: 0, taskDelay: 0 });
  return { runner, role, commands, logs, callbacks: { onLog: (log) => logs.push(log) } };
}

test("完成未领取的日常不重做动作，补领实际任务并核验达到100活跃", async () => {
  const { runner, commands, callbacks, logs } = dailyClaimFixture();
  const result = await runner.run("A", callbacks, noExtraDailyActions);
  assert.equal(result.dailyPoint, 110);
  assert.deepEqual(commands.filter((entry) => entry.command === "task_claimdailypoint")
    .map((entry) => entry.params.taskId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(commands.some(({ command }) => ["store_buy", "store_purchase", "system_mysharecallback", "hero_recruit"].includes(command)), false);
  assert.equal(commands.at(-1).command, "task_claimdailyreward");
  assert.match(logs.at(-1).message, /领取已核验/);
});

test("领取失败或活跃仍不足100时必须报未完成，不能显示所有任务成功", async () => {
  const { runner, callbacks, logs, commands } = dailyClaimFixture({ failClaim: true });
  await assert.rejects(runner.run("A", callbacks, noExtraDailyActions), (error) => {
    assert.equal(error.retryable, false);
    assert.match(error.message, /日常未全部完成.*活跃0\/100.*待领取任务/);
    return true;
  });
  assert.equal(commands.filter(({ command }) => command === "task_claimdailypoint").length, 20);
  assert.equal(logs.some((log) => log.type === "success" && /所有任务/.test(log.message)), false);
});

test("没有待领取奖励是可接受状态，但仍必须通过100活跃核验", async () => {
  const { runner, callbacks } = dailyClaimFixture({ noRewards: true });
  const result = await runner.run("A", callbacks, noExtraDailyActions);
  assert.equal(result.dailyPoint, 110);
});

test("领取响应丢失后按服务器状态复查，不重复领取已成功的任务", async () => {
  const { runner, role } = dailyClaimFixture();
  const ids = [];
  runner.tokenStore.sendMessageWithPromise = async (_id, _command, { taskId }) => {
    ids.push(taskId);
    const task = clientTaskById.get(taskId);
    assert.ok(task, `无效领取ID: ${taskId}`);
    role.dailyTask.complete[task.completeCondition] = -1;
    throw new Error("响应超时");
  };
  await runner.claimDailyPoints("A");
  assert.equal(ids.length, 10);
  assert.deepEqual(getClaimableDailyTaskIds(role), []);
});

test("断线先重连，再发送命令；停止后不能继续发送", async () => {
  const { runner } = dailyClaimFixture();
  const events = [];
  let connected = false;
  runner.tokenStore.getWebSocketStatus = () => connected ? "connected" : "disconnected";
  runner.tokenStore.sendMessageWithPromise = async () => { events.push("send"); return {}; };
  runner.callbacks = { ensureConnection: async () => { events.push("reconnect"); connected = true; } };
  await runner.executeGameCommand("A", "test");
  assert.deepEqual(events, ["reconnect", "send"]);
  runner.callbacks.shouldStop = () => true;
  await assert.rejects(runner.executeGameCommand("A", "test"), /任务已停止/);
  assert.deepEqual(events, ["reconnect", "send"]);
});

test("两次日常同时触发，后一个轮到执行才查活跃，前次已完成则跳过", async () => {
  const queue = createAccountTaskQueue();
  const { runner, callbacks, commands } = dailyClaimFixture();
  const secondRunner = new DailyTaskRunner(runner.tokenStore, { commandDelay: 0, taskDelay: 0 });
  const [first, second] = await Promise.all([
    queue.run("A", () => runner.run("A", callbacks, noExtraDailyActions)),
    queue.run("A", () => secondRunner.run("A", {}, noExtraDailyActions)),
  ]);
  assert.equal(first.skipped, false);
  assert.deepEqual(second, { skipped: true, dailyPoint: 110 });
  assert.equal(commands.filter(({ command }) => command === "task_claimdailyreward").length, 1);
});

test("回归截图：75活跃只补领竞技场8、黑市9、盐罐10，随后重跑跳过", async () => {
  const { runner, role, commands, callbacks } = dailyClaimFixture();
  role.dailyTask.dailyPoint = 75;
  for (let type = 1; type <= 7; type++) role.dailyTask.complete[type] = -1;
  const result = await runner.run("A", callbacks, {
    ...noExtraDailyActions, arenaEnable: true, claimBottle: true, blackMarketPurchase: true,
  });
  assert.deepEqual(commands.filter(({ command }) => command === "task_claimdailypoint")
    .map(({ params }) => params.taskId), [8, 9, 10]);
  assert.equal(role.dailyTask.complete[13], -1);
  assert.equal(role.dailyTask.complete[12], -1);
  assert.equal(role.dailyTask.complete[14], -1);
  assert.equal(result.dailyPoint, 110);
  assert.equal(commands.some(({ command }) => ["store_buy", "store_purchase", "fight_startareaarena", "bottlehelper_claim"].includes(command)), false);
  assert.equal(commands.at(-1).command, "task_claimdailyreward");
  const commandCount = commands.length;
  assert.deepEqual(await runner.run("A", callbacks, noExtraDailyActions),
    { skipped: true, dailyPoint: 110 });
  assert.equal(commands.length, commandCount);
});

test("黑市领取首次失败时仅补领ID9，不重复领取竞技场及盐罐", async () => {
  const { runner, role } = dailyClaimFixture();
  role.dailyTask.dailyPoint = 75;
  for (let type = 1; type <= 7; type++) role.dailyTask.complete[type] = -1;
  const originalSend = runner.tokenStore.sendMessageWithPromise;
  const attempts = [];
  runner.tokenStore.sendMessageWithPromise = async (tokenId, command, params) => {
    if (command === "task_claimdailypoint") {
      attempts.push(params.taskId);
      if (params.taskId === 9 && attempts.filter((id) => id === 9).length === 1) {
        throw new Error("暂时失败");
      }
    }
    return originalSend(tokenId, command, params);
  };
  await runner.claimDailyPoints("A");
  assert.deepEqual(attempts, [8, 9, 10, 9]);
  assert.equal(role.dailyTask.dailyPoint, 110);
  assert.deepEqual(getClaimableDailyTaskIds(role), []);
});
