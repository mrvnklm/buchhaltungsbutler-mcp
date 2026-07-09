import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "./rate-limiter.js";
import type { RateLimitBucket } from "../types/common.js";

// Mirrors the private BUCKET_CONFIGS in rate-limiter.ts. Not imported (not
// exported) so these values are transcribed from the source and must be kept
// in sync if the real configs change.
const BUCKET_CONFIGS: Record<
  RateLimitBucket,
  { maxTokens: number; refillRate: number }
> = {
  general: { maxTokens: 100, refillRate: 100 / 60_000 }, // 100/min
  batch: { maxTokens: 1, refillRate: 1 / 5_000 }, // 1/5s
  upload: { maxTokens: 10, refillRate: 10 / 60_000 }, // 10/min
};

/** Reach into the limiter's private bucket map to read the raw token count. */
function getTokens(limiter: RateLimiter, bucket: RateLimitBucket): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buckets = (limiter as any).buckets as Map<
    RateLimitBucket,
    { tokens: number; lastRefill: number }
  >;
  return buckets.get(bucket)!.tokens;
}

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("initializes each bucket at its configured maxTokens", () => {
      const limiter = new RateLimiter();
      for (const bucket of Object.keys(BUCKET_CONFIGS) as RateLimitBucket[]) {
        expect(getTokens(limiter, bucket)).toBe(
          BUCKET_CONFIGS[bucket].maxTokens
        );
      }
    });
  });

  describe("acquire() with tokens available", () => {
    it("resolves immediately without scheduling any timer", async () => {
      const limiter = new RateLimiter();

      let resolved = false;
      limiter.acquire("general").then(() => {
        resolved = true;
      });

      // Flush pending microtasks (acquire() is now chained through a
      // per-bucket queue promise, so it settles a couple of microtask ticks
      // later rather than on the very next tick) without advancing fake
      // time. If acquire() needed a setTimeout to resolve, `resolved` would
      // still be false here since fake timers never fire on their own.
      await vi.advanceTimersByTimeAsync(0);

      expect(resolved).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("decrements the bucket's token count by 1 per call", async () => {
      const limiter = new RateLimiter();
      const start = BUCKET_CONFIGS.general.maxTokens;

      await limiter.acquire("general");
      expect(getTokens(limiter, "general")).toBe(start - 1);

      await limiter.acquire("general");
      expect(getTokens(limiter, "general")).toBe(start - 2);

      await limiter.acquire("general");
      expect(getTokens(limiter, "general")).toBe(start - 3);
    });
  });

  describe("acquire() throttling once a bucket is exhausted", () => {
    it("waits the amount of time dictated by the bucket's refill rate", async () => {
      const limiter = new RateLimiter();
      const { maxTokens, refillRate } = BUCKET_CONFIGS.batch;

      // Drain the bucket completely (maxTokens is small, e.g. 1 for batch).
      for (let i = 0; i < maxTokens; i++) {
        await limiter.acquire("batch");
      }
      expect(getTokens(limiter, "batch")).toBe(0);

      const expectedWaitMs = Math.ceil((1 - 0) / refillRate);

      let resolved = false;
      limiter.acquire("batch").then(() => {
        resolved = true;
      });

      // Not yet enough time elapsed -- must still be pending.
      await vi.advanceTimersByTimeAsync(expectedWaitMs - 1);
      expect(resolved).toBe(false);

      // Crossing the computed threshold resolves the wait.
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it("serializes two concurrent acquire() calls instead of letting the second ride the first's wait", async () => {
      // Regression test: acquire() previously computed waitMs synchronously
      // before its only await, so two concurrent callers on an exhausted
      // bucket would both compute the same waitMs and both resolve after a
      // single wait -- the second caller got a "free" acquire instead of
      // waiting its own additional interval.
      const limiter = new RateLimiter();
      const { maxTokens, refillRate } = BUCKET_CONFIGS.batch;
      for (let i = 0; i < maxTokens; i++) {
        await limiter.acquire("batch");
      }
      expect(getTokens(limiter, "batch")).toBe(0);

      const singleWaitMs = Math.ceil((1 - 0) / refillRate);

      let firstResolved = false;
      let secondResolved = false;
      limiter.acquire("batch").then(() => {
        firstResolved = true;
      });
      limiter.acquire("batch").then(() => {
        secondResolved = true;
      });

      // After exactly one wait interval, only the first queued acquire
      // should have resolved.
      await vi.advanceTimersByTimeAsync(singleWaitMs);
      expect(firstResolved).toBe(true);
      expect(secondResolved).toBe(false);

      // The second acquire's wait only starts once the first completes, so
      // it needs its own full interval on top -- not simultaneous
      // resolution with the first.
      await vi.advanceTimersByTimeAsync(singleWaitMs);
      expect(secondResolved).toBe(true);
    });
  });

  describe("refill cap", () => {
    it("never refills a bucket above its configured maxTokens", async () => {
      const limiter = new RateLimiter();
      const { maxTokens } = BUCKET_CONFIGS.general;

      // Consume one token so a refill would actually change the value.
      await limiter.acquire("general");
      expect(getTokens(limiter, "general")).toBe(maxTokens - 1);

      // Advance fake time by a huge amount -- far more than needed to
      // "overflow" a naive (uncapped) refill calculation.
      await vi.advanceTimersByTimeAsync(1_000_000_000_000);

      // The next acquire() triggers the refill-on-acquire math. If the cap
      // were missing, tokens would be some enormous number here instead.
      await limiter.acquire("general");
      expect(getTokens(limiter, "general")).toBe(maxTokens - 1);
      expect(getTokens(limiter, "general")).toBeLessThanOrEqual(maxTokens);
    });
  });

  describe("bucket independence", () => {
    it("does not block acquire() on a different, non-exhausted bucket", async () => {
      const limiter = new RateLimiter();
      const { maxTokens } = BUCKET_CONFIGS.batch;

      // Exhaust the batch bucket so any further acquire() against it would
      // have to wait on a timer.
      for (let i = 0; i < maxTokens; i++) {
        await limiter.acquire("batch");
      }
      expect(getTokens(limiter, "batch")).toBe(0);

      // Start (but don't await) a batch acquire that will now be throttled.
      let batchResolved = false;
      limiter.acquire("batch").then(() => {
        batchResolved = true;
      });

      // general and upload buckets are untouched and should resolve
      // immediately, without needing any fake-timer advance.
      let generalResolved = false;
      let uploadResolved = false;
      limiter.acquire("general").then(() => {
        generalResolved = true;
      });
      limiter.acquire("upload").then(() => {
        uploadResolved = true;
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(generalResolved).toBe(true);
      expect(uploadResolved).toBe(true);
      // The throttled batch call must still be pending.
      expect(batchResolved).toBe(false);
    });
  });
});
