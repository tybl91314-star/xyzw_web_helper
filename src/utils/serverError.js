export const RATE_LIMIT_MESSAGE =
  "触发服务器限流（请求过于频繁），请稍后再试";

const RATE_LIMIT_CODES = new Set([200400, 429]);
const RATE_LIMIT_HINT_PATTERN =
  /(?:操作太快|操作过快|请求过于频繁|请求太频繁|too many requests|rate[ _-]?limit(?:ed|ing)?)/i;

export function isRateLimitError(error, code) {
  const message = String(error?.message || error || "");
  return (
    RATE_LIMIT_CODES.has(Number(code)) ||
    /服务器错误:\s*(?:200400|429)\b/i.test(message) ||
    RATE_LIMIT_HINT_PATTERN.test(message)
  );
}

/**
 * 只在错误码或服务端原始提示明确表明限流时转换提示。
 * 未知错误绝不推测为限流，避免掩盖真正的业务或协议错误。
 */
export function normalizeServerErrorDescription(code, description) {
  const rawDescription = String(description || "未知错误");
  if (
    RATE_LIMIT_CODES.has(Number(code)) ||
    RATE_LIMIT_HINT_PATTERN.test(rawDescription)
  ) {
    return RATE_LIMIT_MESSAGE;
  }
  return rawDescription;
}

export function formatServerErrorMessage(code, description) {
  return `服务器错误: ${code} - ${normalizeServerErrorDescription(code, description)}`;
}
