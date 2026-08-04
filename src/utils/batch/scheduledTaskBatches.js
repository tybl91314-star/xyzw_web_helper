export function normalizeAccountBatchSize(value, accountCount) {
  const total = Math.max(0, Number(accountCount) || 0);
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, total);
  return parsed;
}

export function createAccountBatches(accountIds, batchSize) {
  const uniqueIds = [...new Set(Array.isArray(accountIds) ? accountIds : [])];
  const size = normalizeAccountBatchSize(batchSize, uniqueIds.length);
  const batches = [];
  for (let index = 0; index < uniqueIds.length; index += size) {
    batches.push(uniqueIds.slice(index, index + size));
  }
  return batches;
}

export function getBatchIntervalMs(minutes) {
  const parsed = Number(minutes);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 60 * 1000);
}
