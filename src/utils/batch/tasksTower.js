import { getTowerActId } from "../towerActId.js";

/**
 * 爬塔类任务
 * 包含: climbTower, climbWeirdTower, batchClaimFreeEnergy
 */
import { normalizeWeirdTowerMaxClimb } from "../towerClimbLimit.js";

/**
 * 动态定位当前换皮闯关对应的“赛场补给”活动。
 * 主活动和补给活动按服务端同批次连续编号返回，例如 2608072 -> 2608073，
 * 因此不依赖日期或固定活动编号。
 */
export function findSkinChallengeSupplyActivityId(result) {
  const responseBody = result?.body ?? result;
  const activityState = responseBody?.activity ?? responseBody;
  const commonActivityInfo = activityState?.commonActivityInfo ?? {};
  const commonActivityIds = Object.keys(commonActivityInfo)
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  const eGameActivityId = Number(activityState?.actEGameInfo?.actId);
  if (Number.isFinite(eGameActivityId)) {
    const adjacentSupplyId = eGameActivityId + 1;
    if (commonActivityIds.includes(adjacentSupplyId)) return adjacentSupplyId;
  }

  const namedEntry = Object.entries(commonActivityInfo).find(([, info]) => {
    const text = JSON.stringify(info ?? {});
    return /赛场补给|免费补给/.test(text) && !/充值/.test(text);
  });
  return namedEntry ? Number(namedEntry[0]) : null;
}

function findSkinChallengeEGameActivityId(result) {
  const responseBody = result?.body ?? result;
  const activityState = responseBody?.activity ?? responseBody;
  const directId = Number(activityState?.actEGameInfo?.actId);
  if (Number.isFinite(directId) && directId > 0) return directId;

  const candidates = Object.values(activityState?.commonActivityInfo ?? {});
  const eGameInfo = candidates.find((info) => {
    const id = Number(info?.actId ?? info?.activityId ?? info?.id);
    return Number.isFinite(id) && /闯关|寻宝|赛场/.test(JSON.stringify(info ?? {}));
  });
  const candidateId = Number(eGameInfo?.actId ?? eGameInfo?.activityId ?? eGameInfo?.id);
  return Number.isFinite(candidateId) && candidateId > 0 ? candidateId : null;
}

/**
 * 创建爬塔类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksTower(deps) {
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
    currentSettings,
    loadSettings,
    weirdTowerMaxClimb,
  } = deps;

  const wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  // 俱乐部特权由服务端按顺序逐档领取，一次请求只会领取一档。
  // 连续请求直到服务端提示无可领项；任何失败都不能影响后续爬塔。
  const claimEvoTowerClubPrivilege = async (tokenId, tokenName) => {
    let claimedCount = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "evotower_claimlegionprivilege",
          {},
          3000,
        );
        claimedCount++;
        await wait(250);
      } catch (_) {
        break;
      }
    }

    if (claimedCount > 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 已领取怪异塔俱乐部特权 ${claimedCount} 档`,
        type: "success",
      });
    }
    return claimedCount;
  };

  // 合成前领取俱乐部目标奖励。根据服务端返回的俱乐部目标动态领取，
  // 未达到条件或已经领取时服务端会拒绝，静默跳过即可。
  const claimEvoTowerClubTaskRewards = async (tokenId, tokenName, evoTowerInfo) => {
    const taskMap = evoTowerInfo?.evoTower?.legionTaskMap || {};
    const claimMap = evoTowerInfo?.evoTower?.legionTaskClaimMap || {};
    const taskIds = Object.keys(taskMap)
      .map((taskId) => Number(taskId))
      .filter((taskId) => Number.isInteger(taskId) && taskId > 0)
      .sort((a, b) => a - b);
    let claimedCount = 0;

    for (const taskId of taskIds) {
      if (claimMap[taskId] || claimMap[String(taskId)]) continue;
      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "evotower_claimlegiontask",
          { taskId },
          2500,
        );
        claimedCount++;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 已领取怪异塔俱乐部目标奖励 ${taskId}`,
          type: "success",
        });
        await wait(250);
      } catch (_) {
        // 未达成、已领取都属于正常状态，不影响后续合成。
      }
    }
    return claimedCount;
  };

  // 10 层打完后会停在章节奖励/进入下一塔状态；该状态必须先结算，
  // 否则 readyfight 会被服务器拒绝。
  const settleEvoTowerChapter = async (tokenId, tokenName) => {
    try {
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "evotower_claimreward",
        {},
        4000,
      );
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 已领取怪异塔章节通关奖励并进入下一塔`,
        type: "success",
      });
      await wait(500);
      return true;
    } catch (_) {
      return false;
    }
  };

  const getEvoTowerDailyTaskClaimMap = (evoTowerInfo) => {
    const now = new Date();
    const dateKey = `${String(now.getFullYear()).slice(-2)}${String(
      now.getMonth() + 1,
    ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    return evoTowerInfo?.evoTower?.taskClaimMap?.[dateKey] || {};
  };

  // 每日挑战有三档宝箱。每次刷新怪异塔数据后都检查一次，因此开始任务前
  // 已经漏领的档位也会补领，后续新达到的档位同样不会错过。
  const claimEvoTowerDailyChallengeRewards = async (
    tokenId,
    tokenName,
    evoTowerInfo,
    claimedTaskIds,
  ) => {
    const claimMap = getEvoTowerDailyTaskClaimMap(evoTowerInfo);
    let claimedCount = 0;

    for (const taskId of [1, 2, 3]) {
      if (
        claimedTaskIds.has(taskId) ||
        claimMap[taskId] ||
        claimMap[String(taskId)]
      ) {
        continue;
      }

      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "evotower_claimtask",
          { taskId },
          2500,
        );
        claimedTaskIds.add(taskId);
        claimedCount++;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 已领取怪异塔每日挑战奖励第 ${taskId} 档`,
          type: "success",
        });
        await wait(200);
      } catch (_) {
        // 尚未达到、已经领取或当日档位不存在都不影响后续爬塔。
      }
    }

    return claimedCount;
  };

  /**
   * 爬塔
   */
  const climbTower = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      // 加载该Token的独立配置，如果未找到则回退到currentSettings
      const tokenSettings = loadSettings ? (loadSettings(tokenId) || currentSettings) : currentSettings;

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始爬塔: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const teamInfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "presetteam_getinfo",
          {},
          5000,
        );
        if (!teamInfo || !teamInfo.presetTeamInfo) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `阵容信息异常: ${JSON.stringify(teamInfo)}`,
            type: "warning",
          });
        }

        const currentFormation = teamInfo?.presetTeamInfo?.useTeamId;
        let Isswitching = false;
        if (currentFormation === tokenSettings.towerFormation) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `当前已是阵容${tokenSettings.towerFormation}，无需切换`,
            type: "info",
          });
        } else {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_saveteam",
            { teamId: tokenSettings.towerFormation },
            5000,
          );
          Isswitching = true;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `成功切换到阵容${tokenSettings.towerFormation}`,
            type: "info",
          });
        }

        // Initial check
        await tokenStore
          .sendMessageWithPromise(tokenId, "tower_getinfo", {}, 5000)
          .catch(() => {});
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        let energy = roleInfo?.role?.tower?.energy || 0;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 初始体力: ${energy}`,
          type: "info",
        });

        let count = 0;
        const MAX_CLIMB = 100;
        let consecutiveFailures = 0;

        while (energy > 0 && count < MAX_CLIMB && !shouldStop.value) {
          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "fight_starttower",
              {},
              5000,
            );
            count++;
            consecutiveFailures = 0;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 爬塔第 ${count} 次`,
              type: "info",
            });

            await new Promise((r) => setTimeout(r, 1000));

            // Refresh energy
            // 默认每5次刷新一次，或体力不足时刷新
            if (count % 5 === 0) {
               try {
                  roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
                  energy = roleInfo?.role?.tower?.energy || 0;
               } catch (e) {
                 // 忽略刷新失败
               }
            } else {
               // 尝试从本地缓存获取最新的体力信息（如果其他地方更新了）
               const storeRoleInfo = tokenStore.gameData?.roleInfo;
               const storeEnergy = storeRoleInfo?.role?.tower?.energy;
               
               // 如果store中的体力大于当前预计剩余体力，说明可能有额外恢复/奖励，使用store的值
               if (storeEnergy !== undefined && storeEnergy > (energy - 1)) {
                   energy = storeEnergy;
               } else {
                   // 本地扣除体力
                   energy--;
               }
            }
          } catch (err) {
            if (err.message && err.message.includes("200400")) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 触发服务器限流（200400，请求过于频繁），等待5秒后重试...`,
                type: "warning",
              });
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }

            // 处理"上座塔奖励未领取"错误 (1500040)
            if (err.message && err.message.includes("1500040")) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 上座塔奖励未领取，尝试自动领取并等待...`,
                type: "warning",
              });
              
              // 尝试获取当前塔层数
              try {
                // 如果本地没有roleInfo，尝试获取一次
                if (!roleInfo) {
                   roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
                }
                const towerId = roleInfo?.role?.tower?.id;
                
                if (towerId !== undefined) {
                   const rewardFloor = Math.floor(towerId / 10);
                   if (rewardFloor > 0) {
                      addLog({
                        time: new Date().toLocaleTimeString(),
                        message: `${token.name} 尝试领取第 ${rewardFloor} 层奖励`,
                        type: "info",
                      });
                      // 发送领取请求，不等待响应，因为可能通过事件处理了
                      tokenStore.sendMessage(tokenId, "tower_claimreward", { rewardId: rewardFloor });
                   }
                }
              } catch (e) {
                 // 忽略获取信息失败
              }

              // 等待较长时间让领取生效
              await new Promise((r) => setTimeout(r, 3000));
              
              // 刷新角色信息以更新状态
              try {
                 roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
                 energy = roleInfo?.role?.tower?.energy || 0;
              } catch (e) {}

              // 重置连续失败计数，因为这是一个可恢复的错误
              consecutiveFailures = 0;
              continue;
            }

            consecutiveFailures++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `战斗出错: ${err.message} (重试 ${consecutiveFailures}/3)`,
              type: "warning",
            });

            if (consecutiveFailures >= 3) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 连续失败次数过多，停止爬塔`,
                type: "error",
              });
              break;
            }

            await new Promise((r) => setTimeout(r, 2000));

            try {
              roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
              energy = roleInfo?.role?.tower?.energy || 0;
            } catch (e) {
              // 忽略刷新失败
            }
          }
        }
        if (Isswitching) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_saveteam",
            { teamId: currentFormation },
            5000,
          );
        }
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 爬塔结束，共 ${count} 次 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 爬塔失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量爬塔结束");
  };

  /**
   * 爬怪异塔
   */
  const climbWeirdTower = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      // 加载该Token的独立配置，如果未找到则回退到currentSettings
      const tokenSettings = loadSettings ? (loadSettings(tokenId) || currentSettings) : currentSettings;

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始爬怪异塔: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const teamInfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "presetteam_getinfo",
          {},
          5000,
        );
        if (!teamInfo || !teamInfo.presetTeamInfo) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `阵容信息异常: ${JSON.stringify(teamInfo)}`,
            type: "warning",
          });
        }

        const currentFormation = teamInfo?.presetTeamInfo?.useTeamId;
        let Isswitching = false;
        if (currentFormation === tokenSettings.towerFormation) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `当前已是阵容${tokenSettings.towerFormation}，无需切换`,
            type: "info",
          });
        } else {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_saveteam",
            { teamId: tokenSettings.towerFormation },
            5000,
          );
          Isswitching = true;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `成功切换到阵容${tokenSettings.towerFormation}`,
            type: "info",
          });
        }

        const claimedDailyTaskIds = new Set();

        // 获取怪异塔信息
        let evotowerinfo1 = await tokenStore.sendMessageWithPromise(
          tokenId,
          "evotower_getinfo",
          {},
          5000,
        );

        // 开始爬塔前先领取俱乐部特权，并处理已经打完第 10 层、
        // 正等待领取章节奖励/进入下一塔的状态。
        await claimEvoTowerClubPrivilege(tokenId, token.name);
        await claimEvoTowerDailyChallengeRewards(
          tokenId,
          token.name,
          evotowerinfo1,
          claimedDailyTaskIds,
        );
        if (await settleEvoTowerChapter(tokenId, token.name)) {
          evotowerinfo1 = await tokenStore.sendMessageWithPromise(
            tokenId,
            "evotower_getinfo",
            {},
            5000,
          );
          await claimEvoTowerDailyChallengeRewards(
            tokenId,
            token.name,
            evotowerinfo1,
            claimedDailyTaskIds,
          );
        }

        let currentEnergy = evotowerinfo1?.evoTower?.energy;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 初始能量: ${currentEnergy}`,
          type: "info",
        });

        let count = 0;
        const MAX_CLIMB = normalizeWeirdTowerMaxClimb(
          weirdTowerMaxClimb?.value ?? weirdTowerMaxClimb,
        );
        let consecutiveFailures = 0;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 本次最多爬怪异塔 ${MAX_CLIMB} 次`,
          type: "info",
        });

        while (currentEnergy > 0 && count < MAX_CLIMB && !shouldStop.value) {
          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "evotower_readyfight",
              {},
              5000,
            );

            const fightResult = await tokenStore.sendMessageWithPromise(
              tokenId,
              "evotower_fight",
              {
                battleNum: 1,
                winNum: 1,
              },
              10000,
            );

            count++;
            consecutiveFailures = 0;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 爬怪异塔第 ${count} 次`,
              type: "info",
            });

            await new Promise((r) => setTimeout(r, 500));

            const evotowerinfo2 = await tokenStore.sendMessageWithPromise(
              tokenId,
              "evotower_getinfo",
              {},
              5000,
            );
            await claimEvoTowerDailyChallengeRewards(
              tokenId,
              token.name,
              evotowerinfo2,
              claimedDailyTaskIds,
            );

            // 检查是否刚通关10层
            const towerId = evotowerinfo2?.evoTower?.towerId || 0;
            const floor = (towerId % 10) + 1;
            if (
              fightResult &&
              fightResult.winList &&
              fightResult.winList[0] === true &&
              floor === 1
            ) {
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "evotower_claimreward",
                {},
                5000,
              );
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 成功领取第${Math.floor(towerId / 10)}章通关奖励！`,
                type: "success",
              });
              await new Promise((r) => setTimeout(r, 1000));
            }

            // 刷新能量
            try {
              const evotowerinfoRefresh1 = await tokenStore.sendMessageWithPromise(
                tokenId,
                "evotower_getinfo",
                {},
                5000,
              );
              currentEnergy = evotowerinfoRefresh1?.evoTower?.energy || 0;
            } catch (e) {
              // 忽略刷新失败
            }
          } catch (err) {
            // readyfight 在章节结算页会失败；先尝试领取通关奖励，
            // 成功后继续循环，不把正常的换塔状态计作战斗失败。
            if (await settleEvoTowerChapter(tokenId, token.name)) {
              consecutiveFailures = 0;
              try {
                const settledInfo = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "evotower_getinfo",
                  {},
                  5000,
                );
                currentEnergy = settledInfo?.evoTower?.energy || 0;
                await claimEvoTowerDailyChallengeRewards(
                  tokenId,
                  token.name,
                  settledInfo,
                  claimedDailyTaskIds,
                );
              } catch (_) {
                currentEnergy = 0;
              }
              continue;
            }
            consecutiveFailures++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `战斗出错: ${err.message} (重试 ${consecutiveFailures}/3)`,
              type: "warning",
            });

            if (consecutiveFailures >= 3) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 连续失败次数过多，停止爬怪异塔`,
                type: "error",
              });
              break;
            }

            await new Promise((r) => setTimeout(r, 1000));

            try {
              const evotowerinfoRefresh2 = await tokenStore.sendMessageWithPromise(
                tokenId,
                "evotower_getinfo",
                {},
                5000,
              );
              currentEnergy = evotowerinfoRefresh2?.evoTower?.energy || 0;
              await claimEvoTowerDailyChallengeRewards(
                tokenId,
                token.name,
                evotowerinfoRefresh2,
                claimedDailyTaskIds,
              );
            } catch (e) {
              // 忽略刷新失败
            }
          }
        }

        // 即使最后一次战斗后没有再次进入循环，也做一次最终检查，确保刚刚
        // 达成的每日挑战宝箱不会留到下一次运行才领取。
        try {
          const finalEvoTowerInfo = await tokenStore.sendMessageWithPromise(
            tokenId,
            "evotower_getinfo",
            {},
            5000,
          );
          await claimEvoTowerDailyChallengeRewards(
            tokenId,
            token.name,
            finalEvoTowerInfo,
            claimedDailyTaskIds,
          );
        } catch (_) {
          // 最终补领检查失败不影响本次爬塔结果。
        }

        if (Isswitching) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_saveteam",
            { teamId: currentFormation },
            5000,
          );
        }
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 爬怪异塔结束，共 ${count} 次 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 爬怪异塔失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量爬怪异塔结束");
  };

  /** 换皮闯关道具领取 */
  const batchClaimFreeEnergy = async () => {
    if (selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取换皮闯关道具: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const activityResult = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_get",
          {},
          10000,
        );
        const eGameActivityId = findSkinChallengeEGameActivityId(activityResult);
        const supplyActivityId = findSkinChallengeSupplyActivityId(activityResult);
        let claimedStageCount = 0;
        let claimedFreeSupply = false;

        // 右下角累计发射次数奖励：服务端一次领取当前一档，领取后重新读取
        // 下一档状态，直到没有已达成的档次为止。
        if (eGameActivityId) {
          for (let attempt = 0; attempt < 20; attempt++) {
            try {
              const infoResult = await tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_getactegameinfo",
                { actId: eGameActivityId },
                5000,
              );
              const eGame = infoResult?.actEGame ?? infoResult?.body?.actEGame ??
                infoResult?.activity?.actEGame;
              if (Number(eGame?.stageId) === -1) break;

              await tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_actegamestageclaim",
                { actId: eGameActivityId },
                5000,
              );
              claimedStageCount++;
              await wait(250);
            } catch (_) {
              break;
            }
          }
        }

        // 赛场补给属于通用活动商品。客户端配置明确规定免费商品为该活动
        // rank=1 的商品，商品 ID 规则为 activityId * 10 + 1。
        if (supplyActivityId) {
          try {
            const freeGoodsId = supplyActivityId * 10 + 1;
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_commonbuygoods",
              { goodsId: freeGoodsId },
              5000,
            );
            claimedFreeSupply = true;
          } catch (_) {
            // 已领取或当前不可领属于正常状态，不能影响累计档次奖励。
          }
        }

        if (claimedStageCount > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 已领取累计发射奖励 ${claimedStageCount} 档`,
            type: "success",
          });
        }
        if (claimedFreeSupply) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 已领取赛场补给免费道具`,
            type: "success",
          });
        }
        if (claimedStageCount === 0 && !claimedFreeSupply) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前没有可领取的换皮闯关道具`,
            type: "info",
          });
        }

        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 换皮闯关道具领取失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("换皮闯关道具领取结束");
  };

  /**
   * 换皮闯关
   */
  const skinChallenge = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始换皮闯关: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 获取活动信息
        let res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "towers_getinfo",
          { actId: getTowerActId() },
          5000
        );
        
        let towerData = res.actId ? res : (res.towerData && res.towerData.actId ? res.towerData : res);

        // 检查活动是否有效
        if (!towerData.actId) {
           addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 换皮闯关活动信息获取失败`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          return;
        }

        const actId = String(towerData.actId);
        if (actId.length >= 6) {
           const year = "20" + actId.substring(0, 2);
           const month = actId.substring(2, 4);
           const day = actId.substring(4, 6);
           const startDate = new Date(`${year}-${month}-${day}T00:00:00`);
           const endDate = new Date(startDate);
           endDate.setDate(startDate.getDate() + 7);
           const now = new Date();
           if (now < startDate || now >= endDate) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 换皮闯关活动已结束`,
                type: "warning",
              });
              tokenStatus.value[tokenId] = "completed";
              return;
           }
        }

        let levelRewardMap = towerData.levelRewardMap || {};
        
        // 计算今日开放的BOSS
        const todayWeekDay = new Date().getDay(); // 0-6 (Sun-Sat)
        const openTowerMap = {
          5: [1], // Friday
          6: [2], // Saturday
          0: [3], // Sunday
          1: [4], // Monday
          2: [5], // Tuesday
          3: [6], // Wednesday
          4: [1, 2, 3, 4, 5, 6] // Thursday (All open)
        };
        const todayOpenTowers = openTowerMap[todayWeekDay] || [];

        // 辅助函数：判断是否已通关
        const isTowerCleared = (type, map) => {
          const key1 = `${type}008`;
          const key2 = Number(key1);
          return !!(map[key1] || map[key2]);
        };
        
        // 辅助函数：获取当前层数
        const getTowerLevel = (type, map) => {
           for (let i = 8; i >= 1; i--) {
            const key1 = `${type}00${i}`;
            const key2 = Number(key1);
            if (map[key1] || map[key2]) {
                if (i === 8) return 8;
                return i + 1;
            }
          }
          return 1;
        };

        // 筛选未通关的BOSS
        const targetTowers = todayOpenTowers.filter(type => !isTowerCleared(type, levelRewardMap));

        if (todayWeekDay === 4) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 周四全开放，检测到需补打BOSS: ${targetTowers.length > 0 ? targetTowers.join(', ') : '无'}`,
                type: "info",
             });
        } else if (targetTowers.length === 0 && todayOpenTowers.length > 0) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 今日BOSS ${todayOpenTowers[0]} 已通关`,
                type: "info",
             });
        }

        for (const type of targetTowers) {
            if (shouldStop.value) break;

            addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 开始挑战 BOSS ${type}`,
                type: "info",
            });

            let needStart = true;
            let loop = true;
            let failCount = 0;

            while (loop && !shouldStop.value) {
                if (needStart) {
                    await tokenStore.sendMessageWithPromise(tokenId, "towers_start", { actId: getTowerActId(), towerType: type }, 5000);
                    // 稍微等待一下
                    await new Promise(r => setTimeout(r, 500));
                }

                const fightRes = await tokenStore.sendMessageWithPromise(tokenId, "towers_fight", { actId: getTowerActId(), towerType: type }, 5000);
                const battleData = fightRes?.battleData;
                const curHP = battleData?.result?.accept?.ext?.curHP;
                
                const currentLevel = getTowerLevel(type, levelRewardMap);

                if (curHP === 0) {
                     addLog({
                        time: new Date().toLocaleTimeString(),
                        message: `${token.name} BOSS ${type} 第 ${currentLevel} 层挑战成功`,
                        type: "success",
                     });

                     needStart = false;
                     failCount = 0;

                     // 刷新数据
                     res = await tokenStore.sendMessageWithPromise(tokenId, "towers_getinfo", { actId: getTowerActId() }, 5000);
                     towerData = res.actId ? res : (res.towerData && res.towerData.actId ? res.towerData : res);
                     levelRewardMap = towerData.levelRewardMap || {};

                     if (isTowerCleared(type, levelRewardMap)) {
                        loop = false;
                        addLog({
                            time: new Date().toLocaleTimeString(),
                            message: `${token.name} BOSS ${type} 全部通关`,
                            type: "success",
                        });
                     } else {
                        await new Promise(r => setTimeout(r, 1000));
                     }
                } else {
                     addLog({
                        time: new Date().toLocaleTimeString(),
                        message: `${token.name} BOSS ${type} 第 ${currentLevel} 层挑战失败`,
                        type: "warning",
                     });

                     needStart = true;
                     failCount++;

                     if (failCount >= 3) {
                         addLog({
                            time: new Date().toLocaleTimeString(),
                            message: `${token.name} BOSS ${type} 连续失败3次，跳过`,
                            type: "error",
                         });
                         loop = false;
                     } else {
                        await new Promise(r => setTimeout(r, 1000));
                     }
                }
            }
        }

        // 闯关完成后结算活动奖励（该活动命令同时会使用现有发射道具）。
        // 免费补给由独立的“换皮闯关道具领取”功能处理，避免闯关流程重复请求。
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 闯关结束，开始结算活动奖励`,
          type: "info",
        });
        let rewardClaimCount = 0;
        const baseActId = Number(towerData?.actId || getTowerActId());
        const rewardActId = baseActId % 10 === 1 ? baseActId + 1 : baseActId;
        try {
          while (!shouldStop.value) {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_startactegame",
              { actId: rewardActId },
              5000,
            );
            rewardClaimCount += 1;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 活动 ${rewardActId} 领取奖励第 ${rewardClaimCount} 次`,
              type: "success",
            });
            await wait(300);
          }
        } catch {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 活动 ${rewardActId} 奖励结算完成（共 ${rewardClaimCount} 次）`,
            type: "info",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 换皮闯关结束 ===`,
          type: "success",
        });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";

        let errorMessage = error.message;
        if (errorMessage && errorMessage.includes("200330")) {
           errorMessage = "存在未完成的挑战，需要手动处理";
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 换皮闯关失败: ${errorMessage}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 断开连接`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
  };

  /**
   * 批量使用道具
   */
  const batchUseItems = async () => {
    if (selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始使用道具: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 1. 获取活动信息
        const infoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "mergebox_getinfo",
          { actType: 1 },
          5000
        );

        // 获取怪异塔信息以读取剩余道具数量
        const towerInfoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "evotower_getinfo",
          {},
          5000
        );

        if (!infoRes || !infoRes.mergeBox) {
          throw new Error("获取活动信息失败");
        }

        let costTotalCnt = infoRes.mergeBox.costTotalCnt || 0;
        let lotteryLeftCnt = towerInfoRes?.evoTower?.lotteryLeftCnt || 0;

        if (lotteryLeftCnt <= 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 没有剩余道具可使用`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始使用道具，剩余：${lotteryLeftCnt}，已用：${costTotalCnt}`,
          type: "info",
        });

        let processedCount = 0;

        while (lotteryLeftCnt > 0 && !shouldStop.value) {
          let pos = {};
          if (costTotalCnt < 2) {
            pos = { gridX: 4, gridY: 5 };
          } else if (costTotalCnt < 102) {
            pos = { gridX: 7, gridY: 3 };
          } else {
            pos = { gridX: 6, gridY: 3 };
          }

          // 2. 使用道具
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "mergebox_openbox",
            {
              actType: 1,
              pos: pos
            },
            5000
          );

          costTotalCnt++;
          lotteryLeftCnt--;
          processedCount++;

          await new Promise((res) => setTimeout(res, 500));
        }

        // 领取累计奖励
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "mergebox_claimcostprogress",
          { actType: 1 },
          5000
        ).catch(() => {});
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 尝试领取累计使用奖励`,
          type: "info",
        });

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 使用道具结束，共使用 ${processedCount} 次 ===`,
          type: "success",
        });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 使用道具失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 断开连接`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量使用道具结束");
  };

  /**
   * 批量合成
   */
  const batchMergeItems = async () => {
    if (selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键合成: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 合成前先领取怪异塔俱乐部目标奖励。
        try {
          const evoTowerInfo = await tokenStore.sendMessageWithPromise(
            tokenId,
            "evotower_getinfo",
            {},
            5000,
          );
          await claimEvoTowerClubTaskRewards(tokenId, token.name, evoTowerInfo);
        } catch (_) {
          // 未开启怪异塔等情况不影响后续合成。
        }

        let loopCount = 0;
        const MAX_LOOPS = 20;

        while (loopCount < MAX_LOOPS && !shouldStop.value) {
          loopCount++;

          // 获取当前信息
          const infoRes = await tokenStore.sendMessageWithPromise(
            tokenId,
            "mergebox_getinfo",
            { actType: 1 },
            5000
          );

          if (!infoRes || !infoRes.mergeBox) {
            addLog({
               time: new Date().toLocaleTimeString(),
               message: `${token.name} 返回数据缺少 mergeBox`,
               type: "warning",
             });
             break;
          }

          if (loopCount === 1) {
            // 每 3 小时生成的合成道具（最多存 10 个）。
            if (Number(infoRes.mergeBox.freeEnergy || 0) > 0) {
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "mergebox_claimfreeenergy",
                  { actType: 1 },
                  5000,
                );
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 已领取怪异塔合成定时道具`,
                  type: "success",
                });
                await wait(300);
              } catch (_) {
                // 状态可能已由其他客户端更新，继续执行合成。
              }
            }

            // 领取当前已经达到条件的累计消耗奖励。
            try {
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "mergebox_claimcostprogress",
                { actType: 1 },
                5000,
              );
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 已领取怪异塔合成累计消耗奖励`,
                type: "success",
              });
              await wait(300);
            } catch (_) {
              // 当前没有可领取奖励属于正常状态。
            }
          }

          // 领取合成奖励
          if (infoRes.mergeBox.taskMap) {
            const taskMap = infoRes.mergeBox.taskMap;
            const taskClaimMap = infoRes.mergeBox.taskClaimMap || {};

            const rewardMapping = {
              2: { name: "短裙手套", reward: "10随机红色碎片" },
              3: { name: "拽拽菜篮", reward: "2黄金鱼竿" },
              4: { name: "狂野菜板", reward: "2招募令" },
              5: { name: "大胃锅", reward: "2珍珠" },
              6: { name: "幽影茶壶", reward: "5皮肤币" },
              7: { name: "愤怒面包机", reward: "2珍珠" },
              8: { name: "惊讶榨汁机", reward: "1四圣宝珠碎片" },
              9: { name: "动感电饭锅", reward: "5000白玉" },
              10: { name: "迅捷烤炉", reward: "12珍珠" },
              11: { name: "至尊打蛋机", reward: "15彩玉" },
              12: { name: "完美烤炉", reward: "24珍珠" }
            };

            for (const taskId in taskMap) {
              if (shouldStop.value) break;
              if (taskMap[taskId] !== 0 && !taskClaimMap[taskId]) {
                 await tokenStore.sendMessageWithPromise(
                   tokenId,
                   "mergebox_claimmergeprogress",
                   { actType: 1, taskId: parseInt(taskId) },
                   2000
                 ).catch(() => {});

                 const idStr = String(taskId);
                 const lastTwo = parseInt(idStr.slice(-2));
                 const taskInfo = rewardMapping[lastTwo];
                 const taskDesc = taskInfo 
                    ? `${lastTwo}级 ${taskInfo.reward ? " 奖励" + taskInfo.reward : ""}` 
                    : `任务${taskId}`;
                 
                 addLog({
                   time: new Date().toLocaleTimeString(),
                   message: `${token.name} 领取合成奖励: ${taskDesc}`,
                   type: "success",
                 });
                 await new Promise((res) => setTimeout(res, 500));
              }
            }
          }

          // 解析 gridMap
          const gridMap = infoRes.mergeBox.gridMap || {};
          const items = [];

          // 收集所有 gridConfId === 0 的物品
          for (const xStr in gridMap) {
            for (const yStr in gridMap[xStr]) {
              const item = gridMap[xStr][yStr];
              if (item.gridConfId == 0 && item.gridItemId > 0 && !item.isLock) {
                items.push({
                  x: parseInt(xStr),
                  y: parseInt(yStr),
                  id: item.gridItemId
                });
              }
            }
          }

          // 按 gridItemId 分组
          const groupedItems = {};
          items.forEach(item => {
            if (!groupedItems[item.id]) {
              groupedItems[item.id] = [];
            }
            groupedItems[item.id].push(item);
          });

          // 检查是否有可合成项
          let hasPotentialMerge = false;
          for (const id in groupedItems) {
            if (groupedItems[id].length >= 2) {
              hasPotentialMerge = true;
              break;
            }
          }

          if (!hasPotentialMerge) {
            if (loopCount === 1) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 当前没有可合成的物品`,
                type: "info",
              });
            }
            break;
          }

          const isLevel8OrAbove = infoRes.mergeBox.taskMap && infoRes.mergeBox.taskMap["251212208"] && infoRes.mergeBox.taskMap["251212208"] !== 0;

          if (isLevel8OrAbove) {
            // 8级以上使用智能合成
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "mergebox_automergeitem",
              { actType: 1 },
              10000 
            );
            await new Promise((res) => setTimeout(res, 1500));
          } else {
            // 8级以下手动合成
            for (const id in groupedItems) {
              if (shouldStop.value) break;
              const group = groupedItems[id];
              // 两两合成
              while (group.length >= 2) {
                if (shouldStop.value) break;
                const source = group.shift();
                const target = group.shift();

                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "mergebox_mergeitem",
                  {
                    actType: 1,
                    sourcePos: { gridX: source.x, gridY: source.y },
                    targetPos: { gridX: target.x, gridY: target.y }
                  },
                  1000
                ).catch(() => {});
                await new Promise((res) => setTimeout(res, 300));
              }
            }
          }
          
          // 继续下一轮循环
          await new Promise((res) => setTimeout(res, 500));
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 一键合成完成 ===`,
          type: "success",
        });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 一键合成失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 断开连接`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量一键合成结束");
  };

  return {
    climbTower,
    climbWeirdTower,
    batchClaimFreeEnergy,
    skinChallenge,
    batchUseItems,
    batchMergeItems,
  };
}

/**
 * 批量使用道具
 * @param {Object} deps
 */
function batchUseItems(deps) {
  // logic to be implemented inside createTasksTower or moved here if refactored
  // But based on the file structure, I should add it inside createTasksTower
}
