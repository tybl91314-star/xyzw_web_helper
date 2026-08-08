const STAR_UPGRADE_ABORT_PATTERN =
  /200400|400312|操作太快|操作过快|请求超时|timeout|WebSocket|网络|连接(?:已关闭|断开|失败)/i;

export function shouldAbortStarUpgrade(error) {
  return STAR_UPGRADE_ABORT_PATTERN.test(
    String(error?.message || error || ""),
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
  waitAfterSuccess = () => Promise.resolve(),
}) {
  let upgraded = 0;

  while (!shouldStop()) {
    try {
      await sendUpgrade();
      upgraded++;
      await onSuccess(upgraded);
      await waitAfterSuccess();
    } catch (error) {
      return {
        upgraded,
        error,
        abortAccount: shouldAbortStarUpgrade(error),
      };
    }
  }

  return { upgraded, error: null, abortAccount: false };
}
