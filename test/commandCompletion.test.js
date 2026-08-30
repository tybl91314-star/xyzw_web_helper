import test from "node:test";
import assert from "node:assert/strict";
import { classifyCommandCompletion, sendCommandWithCompletion } from "../src/utils/commandCompletion.js";
import { DailyTaskRunner } from "../src/utils/dailyTaskRunner.js";
import { createTasksStore } from "../src/utils/batch/tasksStore.js";
import { createTasksHangUp } from "../src/utils/batch/tasksHangUp.js";

const serverError = (code, text = "未知错误") => new Error(`服务器错误: ${code} - ${text}`);

// 日志明确含义的接口/错误码，以及客户端配置中核实的答题、选将、通行证代码。
const confirmedCases = [
  ["legion_signin", 2300190, "already_completed"],
  ["discount_claimreward", 1000020, "already_completed"],
  ["card_claimreward", 1000020, "already_completed"],
  ["collection_claimfreereward", 12000116, "already_completed"],
  ["system_signinreward", 400190, "nothing_to_claim"],
  ["dungeon_selecthero", 2600040, "already_completed"],
  ["study_startgame", 3100080, "daily_limit_reached"],
  ["task_claimdailypoint", 700020, "already_completed"],
  ["task_claimdailyreward", 3500020, "nothing_to_claim"],
  ["task_claimweekreward", 3500020, "nothing_to_claim"],
  ["activity_recyclewarorderrewardclaim", 3500020, "nothing_to_claim"],
  ["activity_recyclewarorderrewardclaim", 3500030, "already_completed"],
];

test("只有已核实的接口与错误码组合允许无副作用地跳过", () => {
  for (const [command, code, kind] of confirmedCases) {
    const outcome = classifyCommandCompletion(command, serverError(code));
    assert.equal(outcome?.code, code);
    assert.equal(outcome?.kind, kind);
    assert.equal(classifyCommandCompletion("store_buy", serverError(code)), null);
  }
  assert.match(classifyCommandCompletion("dungeon_selecthero", serverError(2600040)).message, /不代表梦境已通关/);
});

test("日志里的真实失败、普通数量上限、限流与未知错误不会被标为完成", () => {
  for (const [command, code] of [
    ["card_claimreward", 1400010], ["gacha_drawreward", 400000],
    ["genie_buysweep", 3300050], ["task_claimweekreward", 200020],
    ["fight_starttower", 1500020], ["task_claimdailypoint", 700010],
    ["study_startgame", 3100070], ["collection_claimfreereward", 200400],
    ["collection_claimfreereward", 999999],
  ]) {
    assert.equal(classifyCommandCompletion(command, serverError(code, "已经完成")), null);
  }
  for (const message of [
    "已经领取过了", "请求超时", "WebSocket未连接",
    "请求超时: 服务器错误: 12000116 - 已领取",
    "服务器错误: 120001160 - 已领取",
  ]) assert.equal(classifyCommandCompletion("collection_claimfreereward", new Error(message)), null);
  assert.equal(classifyCommandCompletion("task_claimdailyreward", new Error("没有可领取的奖励")), null);
});

test("日常中的已完成响应不产生红色失败日志，其他错误仍抛出", async () => {
  const logs = [];
  let nextError;
  const runner = new DailyTaskRunner({
    gameTokens: [{ id: "A", name: "测试" }],
    sendMessageWithPromise: async () => { throw nextError; },
  }, { commandDelay: 0, taskDelay: 0 });
  runner.callbacks = { onLog: (entry) => logs.push(entry) };
  for (const [command, code] of confirmedCases) {
    nextError = serverError(code);
    const result = await runner.executeGameCommand("A", command, {}, command);
    assert.ok(result.completion);
  }
  assert.equal(logs.some((entry) => entry.type === "error"), false);
  nextError = serverError(1400010);
  await assert.rejects(runner.executeGameCommand("A", "card_claimreward", { cardId: 4003 }, "永久卡"), /1400010/);
  assert.equal(logs.at(-1).type, "error");
});

test("批量命令包装不重试，不修改正常响应，不吞掉未知错误", async () => {
  const normal = { reward: [1] };
  let calls = 0;
  const store = { sendMessageWithPromise: async () => { calls++; return normal; } };
  assert.equal(await sendCommandWithCompletion(store, "A", "collection_claimfreereward"), normal);
  store.sendMessageWithPromise = async () => { calls++; throw serverError(12000116); };
  assert.ok((await sendCommandWithCompletion(store, "A", "collection_claimfreereward")).completion);
  await assert.rejects(sendCommandWithCompletion(store, "A", "store_buy"), /12000116/);
  assert.equal(calls, 3);
});

test("建连或初始化错误不能被当作尚未发送的任务已经完成", async () => {
  let sent = false;
  const runner = new DailyTaskRunner({
    gameTokens: [{ id: "A", name: "测试" }],
    getWebSocketStatus: () => "disconnected",
    sendMessageWithPromise: async () => { sent = true; return {}; },
  }, { commandDelay: 0, taskDelay: 0 });
  runner.callbacks = { ensureConnection: async () => { throw serverError(2300190); } };
  await assert.rejects(runner.executeGameCommand("A", "legion_signin"), /2300190/);
  assert.equal(sent, false);
});

function batchFixture(failure) {
  const logs = [];
  let closed = 0;
  const deps = {
    selectedTokens: { value: ["A"] }, tokens: { value: [{ id: "A", name: "测试" }] },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, ensureConnection: async () => {},
    releaseConnectionSlot: () => {}, connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1 }, delayConfig: { action: 0 },
    preloadQuestions: async () => {}, message: { success: () => {} },
    addLog: (entry) => logs.push(entry),
    tokenStore: {
      gameData: {},
      sendMessageWithPromise: async () => { throw failure; },
      closeWebSocketConnection: () => { closed++; },
    },
  };
  return { deps, logs, closed: () => closed };
}

test("一键珍宝阁已领按成功结束，未知错误仍失败", async () => {
  for (const [code, expected] of [[12000116, "completed"], [400000, "failed"], [200400, "failed"]]) {
    const h = batchFixture(serverError(code));
    await createTasksStore(h.deps).collection_claimfreereward();
    assert.equal(h.deps.tokenStatus.value.A, expected);
    assert.equal(h.logs.some((entry) => entry.type === "error"), expected === "failed");
    assert.equal(h.closed(), 1);
  }
});

test("答题次数已用完直接结束，不进入等待答题完成的循环", async () => {
  const h = batchFixture(serverError(3100080));
  await createTasksHangUp(h.deps).batchStudy();
  assert.equal(h.deps.tokenStatus.value.A, "completed");
  assert.equal(h.logs.some((entry) => entry.type === "error"), false);
  assert.ok(h.logs.some((entry) => entry.message.includes("今日答题次数已用完")));
  assert.equal(h.closed(), 1);
});

test("一键俱乐部已签到按成功结束且释放连接", async () => {
  const h = batchFixture(serverError(2300190));
  await createTasksHangUp(h.deps).batchclubsign();
  assert.equal(h.deps.tokenStatus.value.A, "completed");
  assert.equal(h.logs.some((entry) => entry.type === "error"), false);
  assert.equal(h.closed(), 1);
});
