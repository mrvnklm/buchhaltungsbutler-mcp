import type { BbConfig, RateLimitBucket } from "../types/common.js";
import { RateLimiter } from "./rate-limiter.js";
import { ApiError } from "./errors.js";

export class BbClient {
  private rateLimiter = new RateLimiter();
  private authHeader: string;

  constructor(private config: BbConfig) {
    this.authHeader =
      "Basic " + btoa(`${config.apiClient}:${config.apiSecret}`);
  }

  async request<T = unknown>(
    path: string,
    params: Record<string, unknown> = {},
    bucket: RateLimitBucket = "general"
  ): Promise<T> {
    await this.rateLimiter.acquire("general");
    if (bucket !== "general") {
      await this.rateLimiter.acquire(bucket);
    }

    const body = this.encodeParams({ api_key: this.config.apiKey, ...params });

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
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

    return json as T;
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
