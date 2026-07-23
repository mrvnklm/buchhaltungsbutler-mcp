import type { BbConfig, RetryConfig, RateLimitBucket } from "../types/common.js";

/**
 * Request body format. The API has been served x-www-form-urlencoded since
 * v1.0 and that is what the README documents, so it stays the default -- it is
 * the only format with production evidence behind it.
 *
 * "json" exists for the one case form encoding cannot express: a null element
 * inside an array. encodeParams skips null values, so `[1396, null]` would
 * encode as `oi_receipts_ids_by_customer[0]=1396` and the null slot would
 * vanish, silently shifting the remaining ids onto the wrong split lines.
 * Opt into it per call, not globally.
 */
export type RequestEncoding = "form" | "json";

// Error codes that would surface if the API did not parse a JSON body at all:
// api_key travels inside that body, so failing to read it looks like missing
// credentials (3) or an empty POST (23) rather than a format complaint.
const BODY_PARSE_ERROR_CODES = new Set([3, 23]);

/**
 * The JSON body format is what the published Swagger spec declares (every
 * parameter is `in: body`), but it has no production track record -- only the
 * form encoding does. If one of the few JSON calls fails in a way consistent
 * with the body not being read, say so, so the report names the likely cause
 * instead of "credentials unknown".
 *
 * Deliberately only a hint: retrying automatically with form encoding could
 * duplicate a posting that the server already accepted before the response
 * failed, and a silent double booking is worse than a visible error.
 */
function withEncodingHint(
  message: string | undefined,
  encoding: RequestEncoding,
  errorCode: number
): string | undefined {
  if (encoding !== "json" || !BODY_PARSE_ERROR_CODES.has(errorCode)) return message;
  const base = message ?? `API error ${errorCode}`;
  return (
    `${base}\n\nNote: this endpoint sends a JSON request body (needed so null entries in ` +
    `oi_receipts_ids_by_customer survive, which form encoding drops). If the API rejected the ` +
    `body format rather than the credentials, please report this at ` +
    `https://github.com/mrvnklm/buchhaltungsbutler-mcp/issues -- other endpoints are unaffected.`
  );
}
import { RateLimiter } from "./rate-limiter.js";
import { ApiError } from "./errors.js";
import { CacheManager } from "./cache.js";

export class BbClient {
  private rateLimiter = new RateLimiter();
  private authHeader: string;
  private retryConfig: RetryConfig;
  private cache = new CacheManager();

  constructor(private config: BbConfig) {
    this.authHeader =
      "Basic " + btoa(`${config.apiClient}:${config.apiSecret}`);
    this.retryConfig = config.retry ?? {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
    };
  }

  async request<T = unknown>(
    path: string,
    params: Record<string, unknown> = {},
    bucket: RateLimitBucket = "general",
    encoding: RequestEncoding = "form"
  ): Promise<T> {
    if (this.cache.isCacheable(path)) {
      const cacheKey = this.cache.buildKey(path, params);
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) return cached;
    }

    await this.rateLimiter.acquire("general");
    if (bucket !== "general") {
      await this.rateLimiter.acquire(bucket);
    }

    const payload = { api_key: this.config.apiKey, ...params };
    const body = encoding === "json" ? JSON.stringify(payload) : this.encodeParams(payload);
    const { maxAttempts } = this.retryConfig;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.config.baseUrl}${path}`, {
          method: "POST",
          headers: {
            Authorization: this.authHeader,
            "Content-Type":
              encoding === "json" ? "application/json" : "application/x-www-form-urlencoded",
          },
          body,
        });

        const text = await response.text();
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new ApiError(
            0,
            response.status,
            `Non-JSON response from API (HTTP ${response.status}): ${text.slice(0, 200)}`
          );
        }

        if (!response.ok || json.success === false) {
          const errorCode = (json.error_code as number) ?? 0;
          throw new ApiError(
            errorCode,
            response.status,
            withEncodingHint((json.message as string) ?? undefined, encoding, errorCode)
          );
        }

        const result = json as T;

        if (this.cache.isCacheable(path)) {
          const cacheKey = this.cache.buildKey(path, params);
          this.cache.set(cacheKey, result, this.cache.getTtlForEndpoint(path));
        }

        this.cache.invalidateForWrite(path);

        return result;
      } catch (error) {
        const isLast = attempt >= maxAttempts - 1;
        if (isLast || !ApiError.isTransientError(error)) {
          throw error;
        }
        await this.delay(attempt);
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new ApiError(0, 0, "Retry loop exhausted");
  }

  private delay(attempt: number): Promise<void> {
    const { baseDelayMs, maxDelayMs } = this.retryConfig;
    const ms = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs) * Math.random();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Encode params as x-www-form-urlencoded.
   * Handles nested arrays for batch endpoints and invoice line items.
   * e.g. { receipts: [{ type: "invoice" }] } => "receipts[0][type]=invoice"
   */
  private encodeParams(params: Record<string, unknown>): string {
    const parts: string[] = [];

    const encode = (key: string, value: unknown): void => {
      if (value === undefined || value === null) return;

      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (typeof item === "object" && item !== null) {
            for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
              encode(`${key}[${i}][${k}]`, v);
            }
          } else {
            encode(`${key}[${i}]`, item);
          }
        });
      } else if (typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          encode(`${key}[${k}]`, v);
        }
      } else {
        parts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
        );
      }
    };

    for (const [key, value] of Object.entries(params)) {
      encode(key, value);
    }

    return parts.join("&");
  }
}
