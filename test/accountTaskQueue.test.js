import test from "node:test";
import assert from "node:assert/strict";
import { createAccountTaskQueue } from "../src/utils/batch/accountTaskQueue.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("同账号跨入口按先后顺序执行，其他账号不必等待", async () => {
  const queue = createAccountTaskQueue();
  const first = deferred();
  const events = [];
  const a = queue.run("A", async () => { events.push("A-start"); await first.promise; events.push("A-close"); });
  const b = queue.run("A", async () => { events.push("A-next"); });
  await queue.run("B", async () => { events.push("B"); });
  assert.deepEqual(events, ["A-start", "B"]);
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(events, ["A-start", "B", "A-close", "A-next"]);
  assert.equal(queue.size, 0);
});

test("失败释放账号锁；排队任务被停止时不建立或关闭连接", async () => {
  const queue = createAccountTaskQueue();
  const gate = deferred();
  let cancelled = false;
  let ran = false;
  const failing = queue.run("A", async () => { await gate.promise; throw new Error("断线"); });
  const assertion = assert.rejects(failing, /断线/);
  const pending = queue.run("A", () => { ran = true; }, { shouldStop: () => cancelled });
  cancelled = true;
  gate.resolve();
  await assertion;
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(ran, false);
  await queue.run("A", () => { ran = true; });
  assert.equal(ran, true);
  assert.equal(queue.size, 0);
});
