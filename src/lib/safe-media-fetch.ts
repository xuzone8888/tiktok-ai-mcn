import { lookup as dnsLookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_REDIRECTS = 5;
const SENSITIVE_REDIRECT_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);
const FORBIDDEN_CALLER_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

export class ExternalMediaFetchError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "ExternalMediaFetchError";
    this.statusCode = statusCode;
  }
}

export interface ExternalMediaFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  headers: IncomingHttpHeaders;
}

export interface ExternalMediaTempFileResult {
  filePath: string;
  size: number;
  contentType: string;
  finalUrl: string;
  headers: IncomingHttpHeaders;
  cleanup(): Promise<void>;
}

export interface ExternalMediaProbeResult {
  accessible: boolean;
  status: number;
  finalUrl: string;
  headers: IncomingHttpHeaders;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
}

function parseIpv4(address: string): number[] | null {
  const octets = address.split(".").map(Number);
  return octets.length === 4 &&
    octets.every(
      (octet) =>
        Number.isInteger(octet) && octet >= 0 && octet <= 255
    )
    ? octets
    : null;
}

/**
 * Reject every non-global IPv4 range that can target this host, an adjacent
 * network, cloud metadata, carrier/private infrastructure, or a special-use
 * network. Documentation/benchmark ranges are also rejected because a media
 * provider has no legitimate reason to return them.
 */
function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function mappedIpv4FromIpv6(address: string): string | null {
  const normalized = address.toLowerCase();
  const dotted = normalized.match(
    /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/
  );
  if (dotted) return dotted[1];

  const hexadecimal = normalized.match(
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
  );
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = mappedIpv4FromIpv6(normalized);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4);

  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return (
    // Public provider endpoints only need global unicast (2000::/3).
    // Denying other IPv6 classes also closes IPv4-compatible/NAT64 forms
    // that can otherwise tunnel a private IPv4 destination.
    !Number.isFinite(firstHextet) ||
    firstHextet < 0x2000 ||
    firstHextet > 0x3fff ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2001:0:") ||
    normalized.startsWith("2001:0000:") ||
    normalized.startsWith("2001:2:") ||
    /^2001:(?:[12][0-9a-f]):/.test(normalized) ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("3fff:")
  );
}

export function isBlockedExternalMediaAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const version = isIP(normalized);
  if (version === 4) return isBlockedIpv4(normalized);
  if (version === 6) return isBlockedIpv6(normalized);
  return true;
}

function validateExternalMediaUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExternalMediaFetchError("上游媒体 URL 无效");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExternalMediaFetchError("上游媒体 URL 仅允许 HTTP/HTTPS");
  }
  if (url.username || url.password) {
    throw new ExternalMediaFetchError("上游媒体 URL 不允许携带用户凭据");
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new ExternalMediaFetchError("上游媒体 URL 不允许访问本地或内网地址");
  }
  if (isIP(hostname) && isBlockedExternalMediaAddress(hostname)) {
    throw new ExternalMediaFetchError("上游媒体 URL 不允许访问本地或内网地址");
  }

  url.hash = "";
  return url;
}

async function resolvePinnedPublicAddress(
  hostname: string
): Promise<{ address: string; family: 4 | 6 }> {
  const normalized = normalizeHostname(hostname);
  const literalFamily = isIP(normalized);
  if (literalFamily) {
    if (isBlockedExternalMediaAddress(normalized)) {
      throw new ExternalMediaFetchError(
        "上游媒体 URL 解析到了本地或内网地址"
      );
    }
    return {
      address: normalized,
      family: literalFamily as 4 | 6,
    };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(normalized, {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new ExternalMediaFetchError("上游媒体域名解析失败");
  }

  if (addresses.length === 0) {
    throw new ExternalMediaFetchError("上游媒体域名没有可用地址");
  }
  // Reject a mixed public/private answer instead of choosing the public member.
  // This prevents round-robin DNS from switching the subsequent request onto
  // an internal address.
  if (addresses.some(({ address }) => isBlockedExternalMediaAddress(address))) {
    throw new ExternalMediaFetchError(
      "上游媒体 URL 解析到了本地或内网地址"
    );
  }
  const selected = addresses[0];
  return {
    address: selected.address,
    family: selected.family as 4 | 6,
  };
}

function normalizeRequestHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {
    accept: "*/*",
    "accept-encoding": "identity",
    "user-agent": "StarGaze-Media-Transfer/1.0",
  };
  for (const [key, value] of Object.entries(headers ?? {})) {
    const normalizedKey = key.toLowerCase();
    if (!FORBIDDEN_CALLER_HEADERS.has(normalizedKey)) {
      normalized[normalizedKey] = value;
    }
  }
  // Compressed streams would need a second, post-decompression size limit.
  // Asking for identity keeps the byte cap authoritative.
  normalized["accept-encoding"] = "identity";
  return normalized;
}

function headersForRedirect(
  headers: Record<string, string>,
  from: URL,
  to: URL
): Record<string, string> {
  if (from.origin === to.origin) return headers;
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => !SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase())
    )
  );
}

function abortError(signal?: AbortSignal): ExternalMediaFetchError {
  const reason = signal?.reason;
  return new ExternalMediaFetchError(
    reason instanceof Error ? reason.message : "上游媒体下载已取消"
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

async function readIncomingMessageWithCap(
  response: IncomingMessage,
  maxBytes: number
): Promise<Buffer> {
  const declared = Number(response.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new ExternalMediaFetchError(
      `上游媒体超过 ${Math.ceil(maxBytes / 1024 / 1024)}MB 限制`
    );
  }
  const encoding = response.headers["content-encoding"];
  if (
    typeof encoding === "string" &&
    encoding.trim() !== "" &&
    encoding.toLowerCase() !== "identity"
  ) {
    response.destroy();
    throw new ExternalMediaFetchError("上游媒体返回了不受支持的压缩响应");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      response.destroy();
      throw new ExternalMediaFetchError(
        `上游媒体超过 ${Math.ceil(maxBytes / 1024 / 1024)}MB 限制`
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function validateIncomingMediaHeaders(
  response: IncomingMessage,
  maxBytes: number
): void {
  const declared = Number(response.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new ExternalMediaFetchError(
      `上游媒体超过 ${Math.ceil(maxBytes / 1024 / 1024)}MB 限制`
    );
  }
  const encoding = response.headers["content-encoding"];
  if (
    typeof encoding === "string" &&
    encoding.trim() !== "" &&
    encoding.toLowerCase() !== "identity"
  ) {
    response.destroy();
    throw new ExternalMediaFetchError("上游媒体返回了不受支持的压缩响应");
  }
}

async function writeIncomingMessageWithCap(
  response: IncomingMessage,
  maxBytes: number,
  destination: string
): Promise<number> {
  validateIncomingMediaHeaders(response, maxBytes);
  let total = 0;
  const limiter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) {
        callback(
          new ExternalMediaFetchError(
            `上游媒体超过 ${Math.ceil(maxBytes / 1024 / 1024)}MB 限制`
          )
        );
        return;
      }
      callback(null, buffer);
    },
  });
  await pipeline(
    response,
    limiter,
    createWriteStream(destination, { flags: "wx", mode: 0o600 })
  );
  return total;
}

async function requestOnce(input: {
  url: URL;
  headers: Record<string, string>;
  deadline: number;
  method?: "GET" | "HEAD";
  signal?: AbortSignal;
}): Promise<{
  response: IncomingMessage;
}> {
  throwIfAborted(input.signal);
  const remainingMs = input.deadline - Date.now();
  if (remainingMs <= 0) {
    throw new ExternalMediaFetchError("上游媒体下载超时");
  }
  const pinned = await resolvePinnedPublicAddress(input.url.hostname);
  throwIfAborted(input.signal);
  const afterDnsMs = input.deadline - Date.now();
  if (afterDnsMs <= 0) {
    throw new ExternalMediaFetchError("上游媒体下载超时");
  }

  return new Promise((resolve, reject) => {
    const transport =
      input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(
      input.url,
      {
        method: input.method ?? "GET",
        headers: input.headers,
        // Pin the connection to the exact address that passed the public-IP
        // check. TLS SNI/Host continue to use input.url.hostname.
        lookup: (_hostname, options, callback) => {
          if (
            typeof options === "object" &&
            options !== null &&
            "all" in options &&
            options.all
          ) {
            callback(null, [pinned]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const abortResponse = () => response.destroy(abortError(input.signal));
        if (input.signal?.aborted) {
          abortResponse();
          reject(abortError(input.signal));
          return;
        }
        input.signal?.addEventListener("abort", abortResponse, { once: true });
        response.once("close", () =>
          input.signal?.removeEventListener("abort", abortResponse)
        );
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ response });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(
            new ExternalMediaFetchError(
              `上游媒体下载失败: HTTP ${status || "unknown"}`,
              status || undefined
            )
          );
          return;
        }
        resolve({ response });
      }
    );

    const timer = setTimeout(() => {
      request.destroy(new ExternalMediaFetchError("上游媒体下载超时"));
    }, afterDnsMs);
    const abortRequest = () => request.destroy(abortError(input.signal));
    input.signal?.addEventListener("abort", abortRequest, { once: true });
    request.once("close", () => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abortRequest);
    });
    request.once("error", reject);
    request.end();
  });
}

/**
 * Download an untrusted provider media URL with:
 * - DNS resolution and public-address pinning;
 * - manual, revalidated redirects;
 * - cross-origin credential stripping;
 * - a total timeout and streaming byte cap.
 */
export async function fetchExternalMediaBuffer(
  rawUrl: string,
  options: {
    headers?: Record<string, string>;
    maxBytes: number;
    timeoutMs?: number;
  }
): Promise<ExternalMediaFetchResult> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 90_000);
  const maxBytes = Math.max(1, options.maxBytes);
  const deadline = Date.now() + timeoutMs;
  let current = validateExternalMediaUrl(rawUrl);
  let headers = normalizeRequestHeaders(options.headers);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const result = await requestOnce({
      url: current,
      headers,
      deadline,
    });
    const status = result.response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = result.response.headers.location;
      if (!location) {
        throw new ExternalMediaFetchError(
          `上游媒体重定向缺少 Location: HTTP ${status}`,
          status
        );
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new ExternalMediaFetchError("上游媒体重定向次数过多");
      }
      const next = validateExternalMediaUrl(
        new URL(location, current).toString()
      );
      headers = headersForRedirect(headers, current, next);
      current = next;
      continue;
    }

    const buffer = await readIncomingMessageWithCap(
      result.response,
      maxBytes
    );
    return {
      buffer,
      contentType:
        String(result.response.headers["content-type"] ?? "")
          .split(";")[0]
          .trim() || "application/octet-stream",
      finalUrl: current.toString(),
      headers: result.response.headers,
    };
  }

  throw new ExternalMediaFetchError("上游媒体重定向次数过多");
}

/**
 * Safely probes an untrusted URL without downloading its body.
 * DNS pinning and redirect validation are identical to media downloads.
 */
export async function probeExternalMediaUrl(
  rawUrl: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<ExternalMediaProbeResult> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 8_000);
  const deadline = Date.now() + timeoutMs;
  let current = validateExternalMediaUrl(rawUrl);
  let headers = normalizeRequestHeaders(options.headers);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const result = await requestOnce({
      url: current,
      headers,
      deadline,
      method: "HEAD",
    });
    const status = result.response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = result.response.headers.location;
      result.response.resume();
      if (!location) {
        throw new ExternalMediaFetchError(
          `上游媒体重定向缺少 Location: HTTP ${status}`,
          status
        );
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new ExternalMediaFetchError("上游媒体重定向次数过多");
      }
      const next = validateExternalMediaUrl(
        new URL(location, current).toString()
      );
      headers = headersForRedirect(headers, current, next);
      current = next;
      continue;
    }

    result.response.resume();
    return {
      accessible: true,
      status,
      finalUrl: current.toString(),
      headers: result.response.headers,
    };
  }

  throw new ExternalMediaFetchError("上游媒体重定向次数过多");
}

/**
 * Downloads an untrusted media URL into a private bounded temporary file.
 * The caller must invoke cleanup() in a finally block.
 */
export async function fetchExternalMediaToTempFile(
  rawUrl: string,
  options: {
    headers?: Record<string, string>;
    maxBytes: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<ExternalMediaTempFileResult> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 180_000);
  const maxBytes = Math.max(1, options.maxBytes);
  const deadline = Date.now() + timeoutMs;
  let current = validateExternalMediaUrl(rawUrl);
  let headers = normalizeRequestHeaders(options.headers);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    throwIfAborted(options.signal);
    const result = await requestOnce({
      url: current,
      headers,
      deadline,
      signal: options.signal,
    });
    const status = result.response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = result.response.headers.location;
      result.response.resume();
      if (!location) {
        throw new ExternalMediaFetchError(
          `上游媒体重定向缺少 Location: HTTP ${status}`,
          status
        );
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new ExternalMediaFetchError("上游媒体重定向次数过多");
      }
      const next = validateExternalMediaUrl(
        new URL(location, current).toString()
      );
      headers = headersForRedirect(headers, current, next);
      current = next;
      continue;
    }

    const tempDirectory = await mkdtemp(join(tmpdir(), "stargaze-media-"));
    const filePath = join(tempDirectory, "media.bin");
    try {
      const size = await writeIncomingMessageWithCap(
        result.response,
        maxBytes,
        filePath
      );
      return {
        filePath,
        size,
        contentType:
          String(result.response.headers["content-type"] ?? "")
            .split(";")[0]
            .trim() || "application/octet-stream",
        finalUrl: current.toString(),
        headers: result.response.headers,
        cleanup: () => rm(tempDirectory, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  throw new ExternalMediaFetchError("上游媒体重定向次数过多");
}
