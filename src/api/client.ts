import type { BbConfig, RetryConfig, RateLimitBucket } from "../types/common.js";
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
    bucket: RateLimitBucket = "general"
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

    // JSON is the body format documented by the BHB API (all parameters are
    // declared `in: body`; the official setup guide prescribes raw JSON with
    // Content-Type: application/json). Unlike x-www-form-urlencoded, JSON can
    // represent null array elements, which the API requires for
    // oi_receipts_ids_by_customer (null = "this split line clears no receipt").
    const body = JSON.stringify({ api_key: this.config.apiKey, ...params });
    const { maxAttempts } = this.retryConfig;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.config.baseUrl}${path}`, {
          method: "POST",
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
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
          throw new ApiError(
            (json.error_code as number) ?? 0,
            response.status,
            (json.message as string) ?? undefined
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
}
