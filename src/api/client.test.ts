import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BbClient } from "./client.js";
import { ApiError } from "./errors.js";
import type { BbConfig } from "../types/common.js";

const baseConfig: BbConfig = {
  apiClient: "test-client",
  apiSecret: "test-secret",
  apiKey: "test-key",
  baseUrl: "https://api.example.com/v1",
};

function mockFetchResponse(body: object, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as Response;
}

describe("BbClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("retry on transient errors", () => {
    it("retries on rate limit error (code 15) and succeeds", async () => {
      const client = new BbClient({
        ...baseConfig,
        retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
      });

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return mockFetchResponse({ success: false, error_code: 15, message: "Rate limited" }, 429);
        }
        return mockFetchResponse({ success: true, data: "ok" });
      });

      const promise = client.request("/test");
      // Advance timers to let retry delays resolve
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(callCount).toBe(3);
      expect(result).toEqual({ success: true, data: "ok" });
    });

    it("retries on TypeError (network failure) and succeeds", async () => {
      const client = new BbClient({
        ...baseConfig,
        retry: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1000 },
      });

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new TypeError("Failed to fetch");
        }
        return mockFetchResponse({ success: true, data: "recovered" });
      });

      const promise = client.request("/test");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(callCount).toBe(2);
      expect(result).toEqual({ success: true, data: "recovered" });
    });

    it("does NOT retry on non-transient errors", async () => {
      const client = new BbClient({
        ...baseConfig,
        retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
      });

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        return mockFetchResponse({ success: false, error_code: 3, message: "Invalid credentials" }, 401);
      });

      await expect(client.request("/test")).rejects.toThrow(ApiError);
      expect(callCount).toBe(1);
    });

    it("throws after exhausting all retry attempts", async () => {
      // Use real timers for this test to avoid unhandled rejection timing issues
      vi.useRealTimers();

      const client = new BbClient({
        ...baseConfig,
        retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 20 },
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return mockFetchResponse({ success: false, error_code: 15, message: "Rate limited" }, 429);
      });

      await expect(client.request("/test")).rejects.toThrow(ApiError);

      // Restore fake timers for remaining tests
      vi.useFakeTimers();
    });

    it("uses default retry config when none provided", async () => {
      const client = new BbClient(baseConfig);

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return mockFetchResponse({ success: false, error_code: 30, message: "Timeout" }, 504);
        }
        return mockFetchResponse({ success: true, data: "ok" });
      });

      const promise = client.request("/test");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(callCount).toBe(3);
      expect(result).toEqual({ success: true, data: "ok" });
    });
  });

  describe("request encoding", () => {
    it("sends params as a JSON body with Content-Type application/json", async () => {
      const client = new BbClient(baseConfig);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse({ success: true })
      );

      await client.request("/postings/add/transaction", {
        transaction_id_by_customer: 5468,
        amounts: ["97.48"],
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${baseConfig.baseUrl}/postings/add/transaction`);
      expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(JSON.parse(init!.body as string)).toEqual({
        api_key: "test-key",
        transaction_id_by_customer: 5468,
        amounts: ["97.48"],
      });
    });

    it("preserves null array elements (oi_receipts_ids_by_customer)", async () => {
      const client = new BbClient(baseConfig);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse({ success: true })
      );

      await client.request("/postings/add/transaction", {
        transaction_id_by_customer: 5469,
        oi_receipts_ids_by_customer: [1396, null],
      });

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body.oi_receipts_ids_by_customer).toEqual([1396, null]);
    });

    it("omits undefined values from the body", async () => {
      const client = new BbClient(baseConfig);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockFetchResponse({ success: true })
      );

      await client.request("/receipts/get", {
        list_direction: "inbound",
        counterparty: undefined,
      });

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(body).toEqual({ api_key: "test-key", list_direction: "inbound" });
      expect("counterparty" in body).toBe(false);
    });
  });

  describe("caching", () => {
    it("caches responses for cacheable endpoints", async () => {
      const client = new BbClient(baseConfig);

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        return mockFetchResponse({ success: true, data: [{ id: 1 }] });
      });

      const result1 = await client.request("/accounts/get");
      const result2 = await client.request("/accounts/get");

      expect(callCount).toBe(1);
      expect(result1).toEqual(result2);
    });

    it("does NOT cache non-cacheable endpoints", async () => {
      const client = new BbClient(baseConfig);

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        return mockFetchResponse({ success: true, data: [] });
      });

      await client.request("/transactions/get");
      await client.request("/transactions/get");

      expect(callCount).toBe(2);
    });

    it("invalidates cache on write operations", async () => {
      const client = new BbClient(baseConfig);

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        return mockFetchResponse({ success: true, data: [{ id: callCount }] });
      });

      // First read - caches
      await client.request("/accounts/get");
      expect(callCount).toBe(1);

      // Write - should invalidate accounts cache
      await client.request("/accounts/add", { name: "test" });
      expect(callCount).toBe(2);

      // Second read - should fetch fresh (cache invalidated)
      await client.request("/accounts/get");
      expect(callCount).toBe(3);
    });

    it("uses different cache keys for different params", async () => {
      const client = new BbClient(baseConfig);

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        return mockFetchResponse({ success: true, data: [{ id: callCount }] });
      });

      await client.request("/settings/get/debtors", { filter: "a" });
      await client.request("/settings/get/debtors", { filter: "b" });
      await client.request("/settings/get/debtors", { filter: "a" }); // cache hit

      expect(callCount).toBe(2);
    });
  });
});
