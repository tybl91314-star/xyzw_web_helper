export function getNearestParentFolderName(relativePath) {
  const parts = String(relativePath || "")
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}
