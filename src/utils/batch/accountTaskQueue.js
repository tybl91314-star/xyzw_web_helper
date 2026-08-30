// 所有批量入口和手动日常共用此队列。锁覆盖整个任务（包括连接清理），
// 而不只是建连瞬间；失败不会阻塞同账号后续任务。
export function createAccountTaskQueue() {
  const tails = new Map();

  const run = async (tokenId, execute, { shouldStop = () => false, onWaiting } = {}) => {
    const previous = tails.get(tokenId) || Promise.resolve();
    if (tails.has(tokenId)) onWaiting?.();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    tails.set(tokenId, current);
    try {
      await previous;
      if (shouldStop()) return { cancelled: true };
      return await execute();
    } finally {
      release();
      if (tails.get(tokenId) === current) tails.delete(tokenId);
    }
  };

  return { run, get size() { return tails.size; } };
}

export const accountTaskQueue = createAccountTaskQueue();
