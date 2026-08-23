/**
 * 比赛房间任务
 * 仅包含比赛预约，不处理预约奖励（奖励由游戏后续邮件发放）。
 */

export function createTasksPKRoom(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
  } = deps;

  const isAlreadyAppointedError = (error) => {
    const errorText = [
      error?.message,
      error?.msg,
      error?.body?.message,
      error?.body?.msg,
      error?.data?.message,
      error?.data?.msg,
    ]
      .filter(Boolean)
      .join(" ");
    return /(?:已|已经|重复)(?:预约|关注)|already\s*(?:appointed|reserved|followed)|duplicate\s*(?:appointment|reservation)/i.test(
      errorText,
    );
  };

  const batchMatchAppointment = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;

      try {
        await ensureConnection(tokenId);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始比赛预约: ${tokenName} ===`,
          type: "info",
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "pkroom_appoint",
          {},
          8000,
        );

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 比赛预约成功，奖励将由游戏邮件发放`,
          type: "success",
        });
      } catch (error) {
        if (isAlreadyAppointedError(error)) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 本场比赛已经预约，无需重复预约`,
            type: "success",
          });
        } else {
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 比赛预约失败: ${error.message}`,
            type: "error",
          });
        }
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量比赛预约结束");
  };

  return { batchMatchAppointment };
}
