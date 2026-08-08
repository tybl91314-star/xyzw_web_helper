export const LEGACY_FRAGMENT_ITEM_ID = 37007;
export const LEGACY_GIFT_MAX_PER_REQUEST = 9999;
export const LEGACY_GIFT_RATE_LIMIT_RETRY_DELAY_MS = 1200;
export const LEGACY_GIFT_CHUNK_DELAY_MS = 350;
export const LEGACY_GIFT_PRIVILEGE_ID = 501;

// 与游戏数据版本 719e336029 的 LegacyGiftConf / LegacyGiftTaskConf 一致。服务端只返回
// VIP、已赠数量和已领取任务，不直接返回“剩余可赠额度”，官方客户端
// 也是用这两张配置表计算。这里只保留赠送功法残卷所需的最小数据。
const LEGACY_GIFT_BASE_LIMIT_BY_VIP = [
  0, 0, 0, 0, 0, 500, 600, 700, 800, 900, 1000, 1000, 1000, 1000,
  1000, 1000, 1000, 1000, 1000,
];

const LEGACY_GIFT_TASK_REWARD_BY_VIP = {
  1: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
  2: [100, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000],
  3: [120, 240, 480, 720, 960, 1200, 1440, 1680, 1920, 2160, 2400, 2400, 2400, 2400, 2400, 2400, 2400, 2400, 2400],
  4: [30, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 600, 600, 600, 600, 600, 600, 600, 600],
  5: [150, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000],
};

export function parseLegacyGiftWan(value) {
  const numericValue = Number(value);
  if (
    !Number.isFinite(numericValue) ||
    numericValue <= 0 ||
    numericValue > 100 ||
    Math.abs(Math.round(numericValue * 10) - numericValue * 10) > 1e-8
  ) {
    throw new Error("指定数量须大于0且不超过100万，小数最多一位");
  }
  return Math.round(numericValue * 10000);
}

export function getLegacyGiftTarget({ mode, quantityWan, inventory }) {
  const available = Math.max(0, Math.floor(Number(inventory) || 0));
  if (mode === "all") return available;
  return Math.min(available, parseLegacyGiftWan(quantityWan));
}

export function isRetryableGiftTransportError(error) {
  const text = String(error?.message || error || "");
  return /请求超时|WebSocket|网络|连接已关闭/i.test(text);
}

export function isLegacyGiftRateLimitError(error) {
  const text = String(error?.message || error || "");
  return /400312|操作过快/i.test(text);
}

function hasMapKey(value, key) {
  if (value instanceof Map) return value.has(key) || value.has(String(key));
  return Boolean(
    value &&
      typeof value === "object" &&
      (Object.hasOwn(value, key) || Object.hasOwn(value, String(key))),
  );
}

function isSameLocalDay(timestampSeconds, now = Date.now()) {
  const timestamp = Number(timestampSeconds) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const date = new Date(timestamp);
  const current = new Date(now);
  return (
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  );
}

export function getLegacyGiftRemainingLimit({ role, roleLegacy, now } = {}) {
  if (hasMapKey(role?.privilege, LEGACY_GIFT_PRIVILEGE_ID)) {
    return Number.MAX_SAFE_INTEGER;
  }

  const vip = Math.max(
    0,
    Math.min(
      LEGACY_GIFT_BASE_LIMIT_BY_VIP.length - 1,
      Math.floor(Number(role?.vip) || 0),
    ),
  );
  let totalLimit = LEGACY_GIFT_BASE_LIMIT_BY_VIP[vip] || 0;

  for (const [taskId] of getNumericMapEntries(roleLegacy?.giftTaskClaim)) {
    const rewards = LEGACY_GIFT_TASK_REWARD_BY_VIP[Number(taskId)];
    if (rewards) totalLimit += rewards[vip] || 0;
  }

  const sentToday = isSameLocalDay(roleLegacy?.sendGiftResetTime, now)
    ? Math.max(0, Number(roleLegacy?.sendItemCnt) || 0)
    : 0;
  return Math.max(0, totalLimit - sentToday);
}

export const waitForLegacyGift = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function getNumericMapEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

export function getClaimableLegacyGiftTaskIds(roleLegacy) {
  const claimedProgress = new Map(
    getNumericMapEntries(roleLegacy?.giftTaskClaim).map(([id, progress]) => [
      Number(id),
      Math.max(0, Number(progress) || 0),
    ]),
  );

  return getNumericMapEntries(roleLegacy?.giftTask)
    .filter(([id, progress]) => {
      const taskId = Number(id);
      const currentProgress = Math.max(0, Number(progress) || 0);
      const alreadyClaimedProgress = claimedProgress.get(taskId) || 0;

      return taskId > 0 && currentProgress > alreadyClaimedProgress;
    })
    .map(([id]) => Number(id));
}
