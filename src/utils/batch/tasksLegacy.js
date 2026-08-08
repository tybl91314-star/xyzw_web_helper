/**
 * 功法类任务
 * 包含: batchLegacyClaim, batchLegacyGiftSendEnhanced
 */

import {
  getClaimableLegacyGiftTaskIds,
  getLegacyGiftRemainingLimit,
  getLegacyGiftTarget,
  isRetryableGiftTransportError,
  LEGACY_GIFT_CHUNK_DELAY_MS,
  LEGACY_FRAGMENT_ITEM_ID,
  LEGACY_GIFT_MAX_PER_REQUEST,
  LEGACY_GIFT_RATE_LIMIT_RETRY_DELAY_MS,
  waitForLegacyGift,
} from "./legacyGift.js";

/**
 * 创建功法类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksLegacy(deps) {
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
    recipientIdInput,
    recipientInfo,
    securityPassword,
    giftMode,
    giftQuantityWan,
    delayConfig,
  } = deps;

  /**
   * 批量领取功法残卷
   */
  const batchLegacyClaim = async () => {
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
          message: `=== 开始领取功法残卷: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);

        const LegacyClaimHangUpResp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legacy_claimhangup",
          {},
          5000,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 成功领取功法残卷${LegacyClaimHangUpResp.reward[0].value}，共有${LegacyClaimHangUpResp.role.items[37007].quantity}个`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 领取功法残卷失败: ${error.message || "未知错误"}`,
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
    message.success("批量领取功法残卷结束");
  };

  /**
   * 增强版批量赠送功法残卷（含完善的验证和错误处理）
   */
  const batchLegacyGiftSendEnhanced = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择要操作的角色");
      return;
    }

    const recipientId = isScheduledTask
      ? batchSettings.receiverId
      : recipientIdInput.value;
    const password = isScheduledTask
      ? batchSettings.password
      : securityPassword.value;

    const giftConfig = {
      recipientId: Number(recipientId),
      itemId: LEGACY_FRAGMENT_ITEM_ID,
      mode: giftMode.value,
      quantityWan: giftQuantityWan.value,
      serverName: recipientInfo.value?.serverName || "",
      name: recipientInfo.value?.name || "",
    };

    if (!isScheduledTask) {
      if (!giftConfig.recipientId || giftConfig.recipientId <= 0) {
        message.error("请输入有效的接收者ID");
        return;
      }

      if (giftConfig.mode === "specific") {
        try {
          getLegacyGiftTarget({
            mode: giftConfig.mode,
            quantityWan: giftConfig.quantityWan,
            inventory: Number.MAX_SAFE_INTEGER,
          });
        } catch (error) {
          message.error(error.message);
          return;
        }
      }
    }

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    let totalSuccess = 0;
    let totalFailed = 0;

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      try {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 开始赠送功法残卷: ${token.name} ===`,
            type: "info",
          });

          await ensureConnection(tokenId);

          // 客户端的“提升上限”实际调用 legacy_claimgifttask。
          // 先读取任务进度，只尝试领取进度高于已领取记录的额度任务；
          // 未完成任务会被服务器拒绝，网络类错误则继续向上抛，避免误判。
          let legacyInfo = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legacy_getinfo",
            {},
            5000,
          );
          let roleLegacy = legacyInfo?.roleLegacy || {};
          let claimedLimitTaskCount = 0;
          for (let pass = 0; pass < 10; pass++) {
            const taskIds = getClaimableLegacyGiftTaskIds(roleLegacy);
            if (taskIds.length === 0) {
              if (pass === 0) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 当前没有需要领取的赠送上限任务`,
                  type: "info",
                });
              }
              break;
            }

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 检测到 ${taskIds.length} 个可尝试提升赠送上限的任务`,
              type: "info",
            });

            let claimedInPass = 0;
            for (const taskId of taskIds) {
              try {
                const claimResp = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "legacy_claimgifttask",
                  { id: taskId },
                  5000,
                );
                roleLegacy = claimResp?.roleLegacy || roleLegacy;
                claimedInPass++;
                claimedLimitTaskCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 已领取功法赠送上限任务 ${taskId}`,
                  type: "success",
                });
                await waitForLegacyGift(LEGACY_GIFT_CHUNK_DELAY_MS);
              } catch (error) {
                if (isRetryableGiftTransportError(error)) throw error;
                // 进度未完成时服务器会拒绝，跳过即可。
              }
            }
            if (claimedInPass === 0) break;
          }

          if (claimedLimitTaskCount > 0) {
            // 领取上限会触发服务端的操作频率保护，稍候再刷新和赠送。
            await waitForLegacyGift(LEGACY_GIFT_RATE_LIMIT_RETRY_DELAY_MS);
            legacyInfo = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legacy_getinfo",
              {},
              5000,
            );
            roleLegacy = legacyInfo?.roleLegacy || roleLegacy;
          }

          const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          const remainingGiftLimit = getLegacyGiftRemainingLimit({
            role: roleInfo?.role,
            roleLegacy,
          });
          const legacyFragmentCount = Math.max(
            0,
            Number(roleInfo?.role?.items?.[giftConfig.itemId]?.quantity) || 0,
          );
          if (isScheduledTask) {
            if (legacyFragmentCount === 0) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 功法残卷不足，当前拥有: 0 ===`,
                type: "error",
              });
              tokenStatus.value[tokenId] = "failed";
              totalFailed++;
              return;
            }
            const rankroleinfo = await tokenStore.sendMessageWithPromise(
              tokenId,
              "rank_getroleinfo",
              {
                bottleType: 0,
                includeBottleTeam: false,
                isSearch: false,
                roleId: giftConfig.recipientId,
              },
              5000,
            );
            giftConfig.serverName = rankroleinfo?.roleInfo?.serverName || "";
            giftConfig.name = rankroleinfo?.roleInfo?.name || "";
            if (!rankroleinfo?.roleInfo?.roleId) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 赠送功法残卷失败: 接收者${giftConfig.recipientId}不存在`,
                type: "error",
              });
              tokenStatus.value[tokenId] = "failed";
              totalFailed++;
              return;
            }
          }

          const requestedQuantity = getLegacyGiftTarget({
            mode: giftConfig.mode,
            quantityWan: giftConfig.quantityWan,
            inventory: legacyFragmentCount,
          });
          const targetQuantity = Math.min(
            requestedQuantity,
            remainingGiftLimit,
          );

          if (targetQuantity <= 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message:
                remainingGiftLimit <= 0
                  ? `=== ${token.name} 今日功法残卷赠送额度已用完 ===`
                  : `=== ${token.name} 当前没有可赠送的功法残卷 ===`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
            totalFailed++;
            return;
          }

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 开始解除安全密码验证 ===`,
            type: "info",
          });

          await tokenStore.sendMessageWithPromise(
            tokenId,
            "role_commitpassword",
            {
              password: password,
              passwordType: 1,
            },
            5000,
          );

          // sendMessageWithPromise 会在服务端返回非 0 错误码（包括密码错误）时
          // 直接 reject。成功响应并不保证携带完整 role.statistics，不能再用
          // que:wh:tm 是否存在判断密码，否则会把有效密码误报为错误。
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 安全密码验证成功 ===`,
            type: "success",
          });

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} === 计划赠送功法残卷 ${targetQuantity} 个（库存 ${legacyFragmentCount}，当前可赠额度 ${remainingGiftLimit === Number.MAX_SAFE_INTEGER ? "不限" : remainingGiftLimit}），目标:[${giftConfig.serverName}] ID:${giftConfig.recipientId} ${giftConfig.name} ===`,
            type: "info",
          });

          let sentQuantity = 0;
          let remainingQuantity = targetQuantity;

          const sendGiftChunk = async (quantity) => {
            const response = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legacy_sendgift",
              {
                itemCnt: quantity,
                legacyUIds: [],
                targetId: giftConfig.recipientId,
              },
              8000,
            );
            if (!response) throw new Error("赠送请求无响应");
            sentQuantity += quantity;
            remainingQuantity -= quantity;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 已赠送 ${quantity} 个，累计 ${sentQuantity}/${targetQuantity}`,
              type: "success",
            });
            if (remainingQuantity > 0) {
              await waitForLegacyGift(LEGACY_GIFT_CHUNK_DELAY_MS);
            }
          };

          while (remainingQuantity > 0 && !shouldStop.value) {
            const chunk = Math.min(
              remainingQuantity,
              LEGACY_GIFT_MAX_PER_REQUEST,
            );
            await sendGiftChunk(chunk);
          }

          await tokenStore.sendMessage(tokenId, "role_getroleinfo");

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 成功赠送功法残卷 ${sentQuantity} 个给[${giftConfig.serverName}] ID:${giftConfig.recipientId} ${giftConfig.name} ===`,
            type: "success",
          });

          tokenStatus.value[tokenId] = "completed";
          totalSuccess++;
        } catch (error) {
          console.error(`赠送失败: ${error.message}`);

          let errorMsg = error.message || "未知错误";
          let errorType = "error";

          if (errorMsg.includes("200160")) {
            errorMsg = "模块未开启";
          } else if (errorMsg.includes("timeout")) {
            errorMsg = "请求超时";
            errorType = "warning";
          } else if (errorMsg.includes("网络")) {
            errorMsg = "网络错误";
            errorType = "warning";
          }

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 赠送功法残卷失败: ${errorMsg} ===`,
            type: errorType,
          });
          tokenStatus.value[tokenId] = "failed";
          totalFailed++;
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

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 批量赠送功法残卷完成: 成功 ${totalSuccess} 个，失败 ${totalFailed} 个 ===`,
      type: "success",
    });

    message.success(
      `批量赠送功法残卷结束，成功 ${totalSuccess} 个，失败 ${totalFailed} 个`,
    );
  };

  return {
    batchLegacyClaim,
    batchLegacyGiftSendEnhanced,
  };
}
