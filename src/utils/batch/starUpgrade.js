const STAR_UPGRADE_FATAL_PATTERN = /400312|密码(?:解除)?失败|密码.*错误/i;
const STAR_UPGRADE_RETRY_PATTERN =
  /200400|服务器错误:\s*429\b|触发服务器限流|操作太快|操作过快|请求过于频繁|too many requests|rate[ _-]?limit(?:ed|ing)?|请求超时|timeout|WebSocket|网络|连接(?:已关闭|断开|失败)/i;

export function shouldAbortStarUpgrade(error) {
  const errorMessage = String(error?.message || error || "");
  return (
    STAR_UPGRADE_FATAL_PATTERN.test(errorMessage) ||
    STAR_UPGRADE_RETRY_PATTERN.test(errorMessage)
  );
}

/**
 * 对一个武将持续升星，直到服务端明确拒绝或用户停止。
 * 不设置次数上限；游戏本身会在满星或材料不足时返回非 0 错误码。
 */
export async function upgradeStarUntilBlocked({
  sendUpgrade,
  shouldStop = () => false,
  onSuccess = () => {},
  onRetry = () => {},
  waitAfterSuccess = () => Promise.resolve(),
  waitBeforeRetry = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  // 首次失败后最多重试 2 次，即连续 3 次限流便停止当前账号。
  maxRetries = 2,
}) {
  let upgraded = 0;
  let retryCount = 0;

  while (!shouldStop()) {
    try {
      await sendUpgrade();
      upgraded++;
      retryCount = 0;
      await onSuccess(upgraded);
      await waitAfterSuccess();
    } catch (error) {
      const errorMessage = String(error?.message || error || "");
      const isFatal = STAR_UPGRADE_FATAL_PATTERN.test(errorMessage);
      const isRetryable = STAR_UPGRADE_RETRY_PATTERN.test(errorMessage);

      if (!isFatal && isRetryable && retryCount < maxRetries) {
        retryCount++;
        const delay = Math.min(8000, 1200 * 2 ** (retryCount - 1));
        await onRetry(error, retryCount, delay);
        await waitBeforeRetry(delay);
        continue;
      }

      return {
        upgraded,
        error,
        abortAccount: isFatal || isRetryable,
      };
    }
  }

  return { upgraded, error: null, abortAccount: false };
}
