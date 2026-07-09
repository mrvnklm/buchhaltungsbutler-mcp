import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CacheManager } from "./cache.js";

describe("CacheManager", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("buildKey", () => {
    it("builds key from path alone when no params", () => {
      expect(cache.buildKey("/accounts/get", {})).toBe("/accounts/get");
    });

    it("sorts params alphabetically", () => {
      const key = cache.buildKey("/test", { z: "1", a: "2", m: "3" });
      expect(key).toBe("/test?a=2&m=3&z=1");
    });

    it("excludes api_key from cache key", () => {
      const key = cache.buildKey("/test", { api_key: "secret", name: "foo" });
      expect(key).toBe("/test?name=foo");
    });

    it("excludes api_key even when it's the only param", () => {
      const key = cache.buildKey("/test", { api_key: "secret" });
      expect(key).toBe("/test");
    });
  });

  describe("get / set", () => {
    it("returns undefined for missing key", () => {
      expect(cache.get("missing")).toBeUndefined();
    });

    it("stores and retrieves a value", () => {
      cache.set("key1", { data: [1, 2, 3] }, 60_000);
      expect(cache.get("key1")).toEqual({ data: [1, 2, 3] });
    });

    it("returns undefined after TTL expires", () => {
      cache.set("key1", "value", 5_000);
      expect(cache.get("key1")).toBe("value");

      vi.advanceTimersByTime(5_001);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("keeps value alive before TTL expires", () => {
      cache.set("key1", "value", 10_000);
      vi.advanceTimersByTime(9_999);
      expect(cache.get("key1")).toBe("value");
    });
  });

  describe("invalidate", () => {
    it("removes entries matching a prefix", () => {
      cache.set("/accounts/get", "data1", 60_000);
      cache.set("/accounts/get?id=1", "data2", 60_000);
      cache.set("/settings/get/debtors", "data3", 60_000);

      cache.invalidate("/accounts/get");

      expect(cache.get("/accounts/get")).toBeUndefined();
      expect(cache.get("/accounts/get?id=1")).toBeUndefined();
      expect(cache.get("/settings/get/debtors")).toBe("data3");
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      cache.set("a", 1, 60_000);
      cache.set("b", 2, 60_000);
      cache.clear();
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
    });
  });

  describe("isCacheable", () => {
    it("returns true for known cacheable endpoints", () => {
      expect(cache.isCacheable("/accounts/get")).toBe(true);
      expect(cache.isCacheable("/settings/get/postingaccounts")).toBe(true);
      expect(cache.isCacheable("/cost-locations/get")).toBe(true);
      expect(cache.isCacheable("/settings/get/debtors")).toBe(true);
      expect(cache.isCacheable("/settings/get/creditors")).toBe(true);
    });

    it("returns false for non-cacheable endpoints", () => {
      expect(cache.isCacheable("/transactions/get")).toBe(false);
      expect(cache.isCacheable("/receipts/get")).toBe(false);
      expect(cache.isCacheable("/postings/get")).toBe(false);
    });
  });

  describe("getTtlForEndpoint", () => {
    it("returns 24h for accounts", () => {
      expect(cache.getTtlForEndpoint("/accounts/get")).toBe(86_400_000);
    });

    it("returns 2h for debtors", () => {
      expect(cache.getTtlForEndpoint("/settings/get/debtors")).toBe(7_200_000);
    });

    it("returns 0 for unknown endpoint", () => {
      expect(cache.getTtlForEndpoint("/unknown")).toBe(0);
    });
  });

  describe("invalidateForWrite", () => {
    it("invalidates accounts cache on account add", () => {
      cache.set("/accounts/get", "data", 60_000);
      cache.invalidateForWrite("/accounts/add");
      expect(cache.get("/accounts/get")).toBeUndefined();
    });

    it("invalidates debtors cache on debtor add", () => {
      cache.set("/settings/get/debtors", "data", 60_000);
      cache.invalidateForWrite("/settings/add/debtor");
      expect(cache.get("/settings/get/debtors")).toBeUndefined();
    });

    it("invalidates debtors cache on batch debtor add, using the real kebab-case endpoint path", () => {
      // Regression test: INVALIDATION_MAP previously had this keyed as
      // "/settings/addBatch/debtors" (camelCase), which never matched the real
      // request path "/settings/add-batch/debtors" actually sent by settings.ts
      // (and confirmed against the live API spec) -- so this invalidation never
      // fired in practice.
      cache.set("/settings/get/debtors", "data", 60_000);
      cache.invalidateForWrite("/settings/add-batch/debtors");
      expect(cache.get("/settings/get/debtors")).toBeUndefined();
    });

    it("invalidates creditors cache on batch creditor add, using the real kebab-case endpoint path", () => {
      cache.set("/settings/get/creditors", "data", 60_000);
      cache.invalidateForWrite("/settings/add-batch/creditors");
      expect(cache.get("/settings/get/creditors")).toBeUndefined();
    });

    it("invalidates creditors cache on creditor update", () => {
      cache.set("/settings/get/creditors", "data", 60_000);
      cache.invalidateForWrite("/settings/update/creditor");
      expect(cache.get("/settings/get/creditors")).toBeUndefined();
    });

    it("invalidates cost-locations cache on delete", () => {
      cache.set("/cost-locations/get", "data", 60_000);
      cache.invalidateForWrite("/cost-locations/delete");
      expect(cache.get("/cost-locations/get")).toBeUndefined();
    });

    it("does nothing for unrelated write paths", () => {
      cache.set("/accounts/get", "data", 60_000);
      cache.invalidateForWrite("/transactions/add");
      expect(cache.get("/accounts/get")).toBe("data");
    });

    it("also invalidates the combined postingaccounts listing, since it includes accounts/debtors/creditors", () => {
      // /settings/get/postingaccounts is a unified listing (see manage_posting_accounts'
      // exclude_accounts/exclude_debtors/exclude_creditors flags), so writes to
      // accounts, debtors, or creditors must invalidate it too, not just their own
      // dedicated list endpoints -- otherwise a newly added debtor stays invisible
      // there for up to the 24h TTL.
      cache.set("/settings/get/postingaccounts", "data", 60_000);
      cache.invalidateForWrite("/accounts/add");
      expect(cache.get("/settings/get/postingaccounts")).toBeUndefined();

      cache.set("/settings/get/postingaccounts", "data", 60_000);
      cache.invalidateForWrite("/settings/add/debtor");
      expect(cache.get("/settings/get/postingaccounts")).toBeUndefined();

      cache.set("/settings/get/postingaccounts", "data", 60_000);
      cache.invalidateForWrite("/settings/add-batch/creditors");
      expect(cache.get("/settings/get/postingaccounts")).toBeUndefined();
    });
  });
});
