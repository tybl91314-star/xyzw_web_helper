import test from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { createTaskExecutionController } from "../src/utils/batch/taskExecution.js";
import { connectionQueue, createConnectionManager } from "../src/utils/batch/connectionManager.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  const tokens = ref([{ id: "A", name: "A" }, { id: "B", name: "B" }]);
  const selectedTokens = ref(["A"]);
  const isRunning = ref(false);
  const tokenStatus = ref({});
  const settings = { maxActive: 2, connectionTimeout: 50, reconnectDelay: 0 };
  const events = [];
  const connected = new Set();
  const tokenStore = {
    getWebSocketStatus: (id) => connected.has(id) ? "connected" : "disconnected",
    createWebSocketConnection: (id) => { connected.add(id); events.push("connect:" + id); },
    closeWebSocketConnection: (id) => { connected.delete(id); events.push("close:" + id); },
    sendMessageWithPromise: async () => ({}),
  };
  const createTaskDeps = () => ({
    batchSettings: settings, currentSettings: {}, helperSettings: {}, delayConfig: {},
    weirdTowerMaxClimb: ref(10), recipientIdInput: ref(""), recipientInfo: ref(null),
    securityPassword: ref(""), giftMode: ref(""), giftQuantityWan: ref(1),
    selectedTokens, tokens, tokenStatus, isRunning, tokenStore,
  });
  const controller = createTaskExecutionController({
    createTaskDeps, tokens, selectedTokens, tokenStatus, isRunning, tokenStore,
    addLog: () => {}, message: { success() {}, warning() {} }, loadSettings: () => ({}),
  });
  return { ...controller, selectedTokens, isRunning, tokenStatus, settings, events, tokenStore };
}

test("同时定时+手动共享账号队列，账号选择/配置/运行标志独立", async () => {
  const f = fixture();
  const gate = deferred();
  const entered = deferred();
  const seen = [];
  const tasks = f.createQueuedTasks((deps) => ({
    daily: async (wait = false) => {
      const id = deps.selectedTokens.value[0];
      await deps.ensureConnection(id);
      seen.push([id, deps.batchSettings.maxActive]);
      if (wait) { entered.resolve(); await gate.promise; }
      deps.tokenStatus.value[id] = "completed";
      deps.isRunning.value = false;
    },
  }));
  const schedule1 = f.createExecution();
  const schedule2 = f.createExecution();
  const first = tasks.daily.runFor(["A"], [true], schedule1);
  await entered.promise;
  const second = tasks.daily.runFor(["A"], [], schedule2);
  f.selectedTokens.value = ["B"];
  f.settings.maxActive = 3;
  await tasks.daily(); // 手动B并行，不能被两个定时的账号覆盖。
  assert.deepEqual(seen, [["A", 2], ["B", 3]]);
  assert.equal(f.isRunning.value, true);
  assert.equal(f.events.filter((item) => item === "close:A").length, 0);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(seen, [["A", 2], ["B", 3], ["A", 2]]);
  assert.equal(connectionQueue.active, 0);
  f.finishExecution(schedule1);
  assert.equal(f.isRunning.value, true);
  f.finishExecution(schedule2);
  assert.equal(f.isRunning.value, false);
  assert.deepEqual(f.selectedTokens.value, ["B"]);
});

test("停止取消旧的排队任务；新执行不能复活旧任务，异常清理不漏锁", async () => {
  const f = fixture();
  const gate = deferred();
  const entered = deferred();
  let calls = 0;
  const tasks = f.createQueuedTasks((deps) => ({
    action: async (wait = false) => {
      calls++;
      await deps.ensureConnection(deps.selectedTokens.value[0]);
      if (wait) { entered.resolve(); await gate.promise; }
      // 旧模块的开始代码不得将停止信号重置。
      deps.shouldStop.value = false;
      await deps.tokenStore.sendMessageWithPromise("A", "command");
    },
  }));
  const first = tasks.action(true);
  await entered.promise;
  const old = tasks.action();
  f.stopAll();
  const next = tasks.action();
  gate.resolve();
  await Promise.all([first, old, next]);
  assert.equal(calls, 2);
  assert.equal(connectionQueue.active, 0);
  assert.equal(f.isRunning.value, false);
});

test("连接槽按所有权释放，未获取槽位或重复释放不影响其他账号", async () => {
  const f = fixture();
  const make = () => createConnectionManager({
    tokenStore: f.tokenStore, batchSettings: f.settings, addLog: () => {},
  });
  const a = make();
  const b = make();
  await a.ensureConnection("A", [{ id: "A" }]);
  assert.equal(connectionQueue.active, 1);
  b.releaseConnectionSlot();
  assert.equal(connectionQueue.active, 1);
  await a.ensureConnection("A", [{ id: "A" }]); // 重连检查也不能重复占位。
  assert.equal(connectionQueue.active, 1);
  a.releaseConnectionSlot();
  a.releaseConnectionSlot();
  assert.equal(connectionQueue.active, 0);
});

test("不同账号仍受统一并发上限约束，前一个释放后下一个才能连接", async () => {
  const f = fixture();
  f.settings.maxActive = 1;
  const make = () => createConnectionManager({
    tokenStore: f.tokenStore, batchSettings: f.settings, addLog: () => {},
  });
  const a = make();
  const b = make();
  await a.ensureConnection("A", [{ id: "A" }]);
  const waiting = b.ensureConnection("B", [{ id: "B" }]);
  await Promise.resolve();
  assert.equal(f.events.includes("connect:B"), false);
  assert.equal(connectionQueue.active, 1);
  a.releaseConnectionSlot();
  await waiting;
  assert.equal(f.events.includes("connect:B"), true);
  assert.equal(connectionQueue.active, 1);
  b.releaseConnectionSlot();
  assert.equal(connectionQueue.active, 0);
});
