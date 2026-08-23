/**
 * 逐鹿盐山竞猜。
 *
 * 游戏的百分比由双方 cheerCnt 计算而来；逐场选择 cheerCnt 较高的一方。
 * 相同人数时选择左侧，已锁定/已结束/已预测的场次不会发送竞猜请求。
 */

const ROUND_SCHEDULE_COUNT = 26;
const FIRST_ROUND_DATE = new Date(2026, 5, 19);
const ROUND_INTERVAL_DAYS = 21;
const PREDICTION_LOOKAHEAD_DAYS = 7;

// 一轮内 26 场比赛相对于开轮日期的天数和锁定时间。
const ROUND_SCHEDULES = [
  [0, 50400], [0, 61200], [1, 50400], [1, 61200],
  [7, 50400], [7, 61200], [8, 50400], [8, 61200],
  [12, 64800], [12, 73800], [13, 64800], [13, 73800],
  [19, 64800], [19, 73800], [20, 64800], [20, 73800],
  [26, 64800], [26, 73800], [27, 64800],
  [31, 64800], [31, 73800], [32, 64800], [32, 73800],
  [38, 64800], [38, 73800], [39, 68400],
];

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const getCandidateScheduleIds = (now = new Date()) => {
  const candidates = [];
  const lookaheadMs = PREDICTION_LOOKAHEAD_DAYS * 86400000;

  // 客户端当前内置赛程覆盖 12 轮（312 场）。
  for (let roundIndex = 0; roundIndex < 12; roundIndex++) {
    const roundDate = addDays(
      FIRST_ROUND_DATE,
      roundIndex * ROUND_INTERVAL_DAYS,
    );

    ROUND_SCHEDULES.forEach(([dayOffset, lockSeconds], scheduleIndex) => {
      const lockAt = addDays(roundDate, dayOffset);
      lockAt.setHours(0, 0, 0, 0);
      lockAt.setSeconds(lockSeconds);

      const timeUntilLock = lockAt.getTime() - now.getTime();
      if (timeUntilLock > 0 && timeUntilLock <= lookaheadMs) {
        candidates.push({
          scheduleId:
            roundIndex * ROUND_SCHEDULE_COUNT + scheduleIndex + 1,
          lockAt,
        });
      }
    });
  }

  return candidates.sort((a, b) => a.lockAt - b.lockAt);
};

const hasGuessedTeam = (guessMap, teamId) => {
  if (!guessMap || !teamId) return false;
  if (typeof guessMap.has === "function" && guessMap.has(teamId)) return true;
  if (typeof guessMap.get === "function" && guessMap.get(teamId) != null) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(guessMap, teamId)) return true;
  return Object.values(guessMap).some(
    (value) => value === teamId || value?.teamId === teamId,
  );
};

const getTeamName = (team) => team?.name || team?.teamName || team?.teamId;

export function createTasksApexGuess(deps) {
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

  const batchApexGuess = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const candidateSchedules = getCandidateScheduleIds();

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      let successCount = 0;
      let skippedCount = 0;

      try {
        await ensureConnection(tokenId);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始逐鹿盐山竞猜: ${tokenName} ===`,
          type: "info",
        });

        if (candidateSchedules.length === 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前没有处于竞猜期的比赛`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        const roleInfoResp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getroleinfo",
          {},
          8000,
        );
        const guessMap = roleInfoResp?.apexRoleInfo?.guessMap || {};

        for (const { scheduleId } of candidateSchedules) {
          if (shouldStop.value) break;

          let pageIndex = 0;
          let matchIndex = 0;
          let hasMore = true;

          while (hasMore && !shouldStop.value) {
            let listResp;
            try {
              listResp = await tokenStore.sendMessageWithPromise(
                tokenId,
                "apex_getguesslist",
                { scheduleId, idx: pageIndex },
                8000,
              );
            } catch (error) {
              // 赛程已生成但竞猜列表尚未开放时，服务器可能返回业务错误。
              break;
            }

            const matches = Array.isArray(listResp?.apexGuessList)
              ? listResp.apexGuessList
              : [];
            if (matches.length === 0) break;

            for (const pair of matches) {
              matchIndex++;
              if (!Array.isArray(pair) || pair.length < 2) {
                skippedCount++;
                continue;
              }

              const [left, right] = pair;
              if (
                hasGuessedTeam(guessMap, left?.teamId) ||
                hasGuessedTeam(guessMap, right?.teamId)
              ) {
                skippedCount++;
                continue;
              }

              // 已产生胜负/淘汰结果表示比赛已经结束，不能再竞猜。
              if (left?.isOut || right?.isOut || left?.isWin || right?.isWin) {
                skippedCount++;
                continue;
              }

              const leftCount = Number(left?.cheerCnt || 0);
              const rightCount = Number(right?.cheerCnt || 0);
              const totalCount = leftCount + rightCount;

              if (
                !left?.teamId ||
                !right?.teamId ||
                totalCount <= 0
              ) {
                skippedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${tokenName} 赛程${scheduleId}第${matchIndex}场暂无预测数据，已跳过`,
                  type: "warning",
                });
                continue;
              }

              // 比例相同也要竞猜；固定选择左侧，避免随机结果难以复查。
              const selectedTeam = leftCount >= rightCount ? left : right;
              const selectedCount = Math.max(leftCount, rightCount);
              const selectedPercent = Math.round(
                (selectedCount / totalCount) * 100,
              );

              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "apex_guess",
                  { teamId: selectedTeam.teamId },
                  8000,
                );
                successCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${tokenName} 赛程${scheduleId}第${matchIndex}场 → ${getTeamName(selectedTeam)} (${selectedPercent}%)`,
                  type: "success",
                });
              } catch (error) {
                skippedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${tokenName} 赛程${scheduleId}第${matchIndex}场竞猜失败: ${error.message}`,
                  type: "error",
                });
              }

              await new Promise((resolve) => setTimeout(resolve, 400));
            }

            pageIndex += matches.length;
            hasMore = listResp?.last === false;
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${tokenName} 逐鹿盐山竞猜完成: 成功${successCount}，跳过${skippedCount} ===`,
          type: "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 逐鹿盐山竞猜失败: ${error.message}`,
          type: "error",
        });
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
    message.success("批量逐鹿盐山竞猜结束");
  };

  return { batchApexGuess };
}
