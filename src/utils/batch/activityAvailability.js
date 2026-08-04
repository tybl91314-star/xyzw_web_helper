const toDate = (value = Date.now()) =>
  value instanceof Date ? value : new Date(value);

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
