import { isIP } from "node:net";

export const MAX_REFERENCE_IMAGE_BYTES = 80 * 1024 * 1024;
export const DEFAULT_IMAGE_REFERENCE_ALLOWED_HOSTS = ["media.toryxai.com"] as const;
export const DEFAULT_REFERENCE_IMAGE_FETCH_TIMEOUT_MS = 30_000;

export class ImageReferenceUrlError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ImageReferenceUrlError";
    this.statusCode = statusCode;
  }
}

function getAllowedHosts(): string[] {
  const configuredHosts = (process.env.IMAGE_REFERENCE_ALLOWED_HOSTS || "")
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);

  return configuredHosts.length > 0
    ? configuredHosts
    : [...DEFAULT_IMAGE_REFERENCE_ALLOWED_HOSTS];
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254);
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb");
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);

  return false;
}

function isAllowedHostname(hostname: string, allowedHosts: string[]): boolean {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some(host => {
    const allowed = host.replace(/^\*\./, "").replace(/^\./, "").toLowerCase();
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

export function validateImageReferenceUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ImageReferenceUrlError("参考图 URL 无效");
  }

  if (parsed.protocol !== "https:") {
    throw new ImageReferenceUrlError("参考图 URL 仅允许 HTTPS");
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new ImageReferenceUrlError("参考图 URL 不允许访问本地或内网地址");
  }

  const allowedHosts = getAllowedHosts();
  if (!isAllowedHostname(parsed.hostname, allowedHosts)) {
    throw new ImageReferenceUrlError("参考图 URL 域名不在允许列表");
  }

  parsed.hash = "";
  return parsed;
}

export function validateImageReferenceUrls(inputs: string[]): URL[] {
  return inputs.map(input => validateImageReferenceUrl(input));
}

export async function fetchImageReferenceUrl(
  input: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
  } = {}
): Promise<Response> {
  const parsed = validateImageReferenceUrl(input);
  const timeoutMs = options.timeoutMs || DEFAULT_REFERENCE_IMAGE_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes || MAX_REFERENCE_IMAGE_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new ImageReferenceUrlError("参考图 URL 不允许重定向");
    }

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new ImageReferenceUrlError("参考图超过 80MB 限制");
    }

    return response;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ImageReferenceUrlError(`参考图下载超时 (${timeoutMs}ms)`, 408);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
