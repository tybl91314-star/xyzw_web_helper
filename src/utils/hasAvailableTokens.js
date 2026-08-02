export function hasAvailableTokens(tokenStore) {
  const storeTokens = tokenStore?.gameTokens;
  const resolvedTokens = Array.isArray(storeTokens)
    ? storeTokens
    : storeTokens?.value;

  if (Array.isArray(resolvedTokens) && resolvedTokens.length > 0) {
    return true;
  }

  try {
    const persistedTokens = JSON.parse(localStorage.getItem("gameTokens") || "[]");
    return Array.isArray(persistedTokens) && persistedTokens.length > 0;
  } catch {
    return false;
  }
}
