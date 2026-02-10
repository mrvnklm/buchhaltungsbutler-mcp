import type { RateLimitBucket } from "../types/common.js";

interface BucketConfig {
  maxTokens: number;
  refillRate: number; // tokens per ms
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

const BUCKET_CONFIGS: Record<RateLimitBucket, BucketConfig> = {
  general: { maxTokens: 100, refillRate: 100 / 60_000 }, // 100/min
  batch: { maxTokens: 1, refillRate: 1 / 5_000 }, // 1/5s
  upload: { maxTokens: 10, refillRate: 10 / 60_000 }, // 10/min
};

export class RateLimiter {
  private buckets = new Map<RateLimitBucket, BucketState>();

  constructor() {
    for (const [key, config] of Object.entries(BUCKET_CONFIGS)) {
      this.buckets.set(key as RateLimitBucket, {
        tokens: config.maxTokens,
        lastRefill: Date.now(),
      });
    }
  }

  async acquire(bucket: RateLimitBucket): Promise<void> {
    const config = BUCKET_CONFIGS[bucket];
    const state = this.buckets.get(bucket)!;

    const now = Date.now();
    const elapsed = now - state.lastRefill;
    state.tokens = Math.min(
      config.maxTokens,
      state.tokens + elapsed * config.refillRate
    );
    state.lastRefill = now;

    if (state.tokens < 1) {
      const waitMs = Math.ceil((1 - state.tokens) / config.refillRate);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      state.tokens = 0;
      state.lastRefill = Date.now();
    } else {
      state.tokens -= 1;
    }
  }
}
