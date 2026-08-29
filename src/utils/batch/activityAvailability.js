const toDate = (value = Date.now()) =>
  value instanceof Date ? value : new Date(value);

const ACTIVITY_CYCLE_START = new Date("2025-12-12T12:00:00");
const ACTIVITY_WEEK_DURATION = 7 * 24 * 60 * 60 * 1000;
const ACTIVITY_CYCLE_DURATION = 3 * ACTIVITY_WEEK_DURATION;

export const getActivityWeekAt = (value = Date.now()) => {
  const elapsed = toDate(value) - ACTIVITY_CYCLE_START;
  if (elapsed < 0) return null;

  const cyclePosition = elapsed % ACTIVITY_CYCLE_DURATION;
  if (cyclePosition < ACTIVITY_WEEK_DURATION) return "黑市周";
  if (cyclePosition < 2 * ACTIVITY_WEEK_DURATION) return "招募周";
  return "宝箱周";
};

export const isWeirdTowerActivityOpenAt = (value = Date.now()) => {
  const now = toDate(value);
  if (getActivityWeekAt(now) !== "黑市周") return false;

  // 黑市周从周五中午开始，但怪异塔爬塔在下一周周四结束。
  return now.getDay() !== 5 || now.getHours() >= 12;
};

export const isWeirdTowerMergeAvailableAt = (value = Date.now()) => {
  const now = toDate(value);
  if (isWeirdTowerActivityOpenAt(now)) return true;

  // 黑市周结束后的周五上午仍允许清理并合成剩余道具，11:00关闭。
  return (
    getActivityWeekAt(now) === "黑市周" &&
    now.getDay() === 5 &&
    now.getHours() < 11
  );
};

export const isCarActivityOpenAt = (value = Date.now()) => {
  const now = toDate(value);
  const day = now.getDay();
  const hour = now.getHours();
  return day >= 1 && day <= 3 && hour >= 6 && hour < 20;
};

export const isDreamActivityOpenAt = (value = Date.now()) => {
  const day = toDate(value).getDay();
  return day === 0 || day === 1 || day === 3 || day === 4;
};

export const isVaultActivityOpenAt = (value = Date.now()) => {
  const day = toDate(value).getDay();
  return day !== 1 && day !== 2;
};

export const isArenaActivityOpenAt = (value = Date.now()) => {
  const hour = toDate(value).getHours();
  return hour >= 6 && hour < 22;
};
