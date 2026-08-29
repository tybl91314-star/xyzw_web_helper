import test from "node:test";
import assert from "node:assert/strict";

import {
  DAILY_ACTIVITY_TARGET,
  DailyTaskRunner,
  FINAL_REWARD_TASKS,
  getDailyActivityPoint,
  getRemainingLegionBossFights,
  isDailyActivityComplete,
} from "../src/utils/dailyTaskRunner.js";

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
