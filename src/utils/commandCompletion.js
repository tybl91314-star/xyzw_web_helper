// 仅按“具体接口 + 已核实的服务端错误码”判断可安全跳过的重复操作。
// 2600040/3100080/3500030 等语义来自游戏客户端配置表；其余也已在日志验证。
// 未知错误、超时、限流、资源不足和通用数量上限不在此表中。
const rules = {
  legion_signin: {
    2300190: ["already_completed", "今天已经签到过了，无需重复签到"],
  },
  discount_claimreward: {
    1000020: ["already_completed", "今日礼包已领取，无需重复领取"],
  },
  card_claimreward: {
    1000020: ["already_completed", "该卡今日奖励已领取，无需重复领取"],
  },
  collection_claimfreereward: {
    12000116: ["already_completed", "今日珍宝阁免费奖励已领取，无需重复领取"],
  },
  system_signinreward: {
    400190: ["nothing_to_claim", "没有可领取的签到奖励，本次无需领取"],
  },
  dungeon_selecthero: {
    2600040: ["already_completed", "梦境已选择上阵武将，无需重复选将（不代表梦境已通关）"],
  },
  study_startgame: {
    3100080: ["daily_limit_reached", "今日答题次数已用完，无需再次开始答题"],
  },
  task_claimdailypoint: {
    700020: ["already_completed", "该任务积分已领取，无需重复领取"],
  },
  task_claimdailyreward: {
    3500020: ["nothing_to_claim", "没有可领取的日活跃奖励，本次无需领取"],
  },
  task_claimweekreward: {
    3500020: ["nothing_to_claim", "没有可领取的周活跃奖励，本次无需领取"],
  },
  activity_recyclewarorderrewardclaim: {
    3500020: ["nothing_to_claim", "没有可领取的通行证奖励，本次无需领取"],
    3500030: ["already_completed", "通行证奖励已全部领取，无需重复领取"],
  },
};

export function classifyCommandCompletion(command, error) {
  // 不扫描任意文本中的数字，避免把超时日志、嵌套错误或相似错误码误判。
  const match = /^服务器错误:\s*(\d+)\s*-/.exec(String(error?.message || ""));
  if (!match) return null;
  const code = Number(match[1]);
  const rule = Object.prototype.hasOwnProperty.call(rules, command) && rules[command][code];
  if (!rule) return null;
  return { code, kind: rule[0], message: rule[1] };
}

export async function sendCommandWithCompletion(
  tokenStore, tokenId, command, params = {}, timeout = 5000,
) {
  try {
    return await tokenStore.sendMessageWithPromise(tokenId, command, params, timeout);
  } catch (error) {
    const completion = classifyCommandCompletion(command, error);
    if (!completion) throw error;
    return { completion };
  }
}
