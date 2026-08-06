export type OssUserMetadata = Record<string, string>;

/**
 * ali-oss `head()` normally strips `x-oss-meta-`, but normalize defensively
 * because proxies/SDK versions can preserve the prefix or header casing.
 */
export function normalizeOssUserMetadata(value: unknown): OssUserMetadata {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key.toLowerCase().replace(/^x-oss-meta-/, ""),
      String(entry),
    ])
  );
}
