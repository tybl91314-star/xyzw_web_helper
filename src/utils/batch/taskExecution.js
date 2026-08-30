import { ref } from "vue";
import { accountTaskQueue } from "./accountTaskQueue.js";
import { createConnectionManager } from "./connectionManager.js";

export function createTaskExecutionController({
  createTaskDeps, tokens, selectedTokens, tokenStatus, isRunning,
  tokenStore, addLog, message, loadSettings,
}) {
  // 每次触发保存账号之外的参数快照；停止信号只影响当时已存在的执行。
  // 定时任务不再改写页面 selectedTokens；旧模块获得单账号独立依赖。
  const executions = new Set();
  const cloneTaskValue = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const createExecution = () => {
    const deps = createTaskDeps();
    for (const key of ["batchSettings", "currentSettings", "helperSettings", "delayConfig"]) {
      deps[key] = cloneTaskValue(deps[key]);
    }
    for (const key of ["weirdTowerMaxClimb", "recipientIdInput", "recipientInfo",
      "securityPassword", "giftMode", "giftQuantityWan"]) {
      deps[key] = ref(cloneTaskValue(deps[key].value));
    }
    const settings = new Map(tokens.value.map((token) => [token.id, cloneTaskValue(loadSettings(token.id))]));
    deps.loadSettings = (id) => cloneTaskValue(settings.get(id));
    const execution = { deps, cancelled: false, failed: 0 };
    executions.add(execution);
    isRunning.value = true;
    return execution;
  };
  const finishExecution = (execution) => {
    executions.delete(execution);
    isRunning.value = executions.size > 0;
  };

  // 一个功能一次触发可有多个账号；仅相同账号排队，不阻塞其他账号。
  const createQueuedTasks = (factory) => {
    const names = Object.keys(factory(createTaskDeps()));
    return Object.fromEntries(names.map((name) => {
      const runFor = async (ids, args = [], parentExecution = null) => {
        const execution = parentExecution || createExecution();
        const accountIds = [...new Set(ids)];
        try {
          const results = await Promise.all(accountIds.map((tokenId) =>
            accountTaskQueue.run(tokenId, async () => {
              const localStatus = ref({});
              const stopSignal = {
                get value() { return execution.cancelled; },
                set value(value) { if (value) execution.cancelled = true; },
              };
              const manager = createConnectionManager({
                tokenStore,
                batchSettings: execution.deps.batchSettings,
                addLog,
                shouldStop: () => execution.cancelled,
              });
              let connectionUsed = false;
              const scopedStore = new Proxy(tokenStore, {
                get(target, key) {
                  if (["sendMessageWithPromise", "sendMessage", "sendGetRoleInfo"].includes(key)) {
                    return (...args) => {
                      if (execution.cancelled) throw new Error("任务已停止");
                      return target[key](...args);
                    };
                  }
                  return Reflect.get(target, key);
                },
              });
              const deps = {
                ...execution.deps,
                tokenStore: scopedStore,
                selectedTokens: ref([tokenId]),
                tokenStatus: localStatus,
                isRunning: ref(false),
                shouldStop: stopSignal,
                currentRunningTokenId: ref(null),
                connectionQueue: manager.connectionQueue,
                releaseConnectionSlot: manager.releaseConnectionSlot,
                ensureConnection: async (id) => {
                  connectionUsed = true;
                  return manager.ensureConnection(id, tokens.value);
                },
                // 批量结束提示由外层汇总，避免每个账号弹一次。
                message: { ...message, success: () => {} },
              };
              tokenStatus.value[tokenId] = "running";
              try {
                await factory(deps)[name](...args);
                return localStatus.value[tokenId] || "completed";
              } catch (error) {
                localStatus.value[tokenId] = "failed";
                addLog({ time: new Date().toLocaleTimeString(),
                  message: `${tokenId} 执行失败: ${error.message}`, type: "error" });
                return "failed";
              } finally {
                // 清理完成后才释放账号锁，且只能释放本执行拥有的连接槽。
                if (connectionUsed) tokenStore.closeWebSocketConnection(tokenId);
                manager.releaseConnectionSlot();
                tokenStatus.value[tokenId] = execution.cancelled
                  ? "stopped" : (localStatus.value[tokenId] || "completed");
              }
            }, {
              shouldStop: () => execution.cancelled,
              onWaiting: () => addLog({ time: new Date().toLocaleTimeString(),
                message: `${tokens.value.find((t) => t.id === tokenId)?.name || tokenId} 同账号任务正在执行，已排队等待`,
                type: "info" }),
            })
          ));
          execution.failed += results.filter((status) => status === "failed").length;
          if (!parentExecution) {
            if (execution.cancelled) message.warning("任务已停止");
            else if (results.includes("failed")) message.warning("批量任务结束，存在失败账号，请查看日志");
            else message.success("批量任务执行结束");
          }
          return results;
        } finally {
          if (!parentExecution) finishExecution(execution);
        }
      };
      const task = (...args) => runFor([...selectedTokens.value], args);
      task.runFor = runFor;
      return [name, task];
    }));
  };


  return {
    createExecution, finishExecution, createQueuedTasks,
    stopAll: () => { for (const execution of executions) execution.cancelled = true; },
  };
}
