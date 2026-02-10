import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllPages } from "./pagination.js";
import type { ApiResponse } from "../types/common.js";

// Minimal mock of BbClient
function createMockClient(pages: Array<{ data: unknown[]; rows?: number }>) {
  let callIndex = 0;
  return {
    request: vi.fn(async <T>(): Promise<T> => {
      const page = pages[callIndex] ?? { data: [] };
      callIndex++;
      return {
        success: true,
        message: "OK",
        rows: page.rows,
        data: page.data,
      } as T;
    }),
  };
}

describe("fetchAllPages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a single page when data is less than pageSize", async () => {
    const client = createMockClient([
      { data: [{ id: 1 }, { id: 2 }], rows: 2 },
    ]);

    const result = await fetchAllPages(
      client as any,
      "/test",
      {},
      { pageSize: 10 }
    );

    expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.pagesLoaded).toBe(1);
    expect(result.totalRows).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("fetches multiple pages until data exhausted", async () => {
    const client = createMockClient([
      { data: [{ id: 1 }, { id: 2 }], rows: 5 },
      { data: [{ id: 3 }, { id: 4 }] },
      { data: [{ id: 5 }] }, // less than pageSize → stop
    ]);

    const result = await fetchAllPages(
      client as any,
      "/test",
      {},
      { pageSize: 2 }
    );

    expect(result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    expect(result.pagesLoaded).toBe(3);
    expect(result.totalRows).toBe(5);
    expect(result.hasMore).toBe(false);
  });

  it("stops at maxPages limit", async () => {
    const client = createMockClient([
      { data: [{ id: 1 }, { id: 2 }], rows: 100 },
      { data: [{ id: 3 }, { id: 4 }] },
    ]);

    const result = await fetchAllPages(
      client as any,
      "/test",
      {},
      { pageSize: 2, maxPages: 2 }
    );

    expect(result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    expect(result.pagesLoaded).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it("stops when totalRows reached", async () => {
    const client = createMockClient([
      { data: [{ id: 1 }, { id: 2 }], rows: 3 },
      { data: [{ id: 3 }, { id: 4 }] }, // allData.length (4) >= totalRows (3) → stop
    ]);

    const result = await fetchAllPages(
      client as any,
      "/test",
      {},
      { pageSize: 2 }
    );

    expect(result.data).toHaveLength(4); // accumulated before check
    expect(result.pagesLoaded).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it("passes correct offset to each page request", async () => {
    const client = createMockClient([
      { data: [{ id: 1 }], rows: 3 },
      { data: [{ id: 2 }] },
      { data: [{ id: 3 }] },
    ]);

    await fetchAllPages(
      client as any,
      "/test",
      { filter: "x" },
      { pageSize: 1 }
    );

    expect(client.request).toHaveBeenCalledTimes(3);

    // Verify offsets
    const calls = client.request.mock.calls;
    expect(calls[0][1]).toEqual({ filter: "x", limit: 1, offset: 0 });
    expect(calls[1][1]).toEqual({ filter: "x", limit: 1, offset: 1 });
    expect(calls[2][1]).toEqual({ filter: "x", limit: 1, offset: 2 });
  });

  it("respects initial offset from params", async () => {
    const client = createMockClient([
      { data: [{ id: 5 }] }, // less than pageSize → stop
    ]);

    await fetchAllPages(
      client as any,
      "/test",
      { offset: 4 },
      { pageSize: 10 }
    );

    const calls = client.request.mock.calls;
    expect(calls[0][1]).toEqual({ offset: 4, limit: 10 });
  });

  it("handles empty first page", async () => {
    const client = createMockClient([{ data: [], rows: 0 }]);

    const result = await fetchAllPages(
      client as any,
      "/test",
      {},
      { pageSize: 10 }
    );

    expect(result.data).toEqual([]);
    expect(result.pagesLoaded).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("defaults to pageSize 500 and maxPages 10", async () => {
    const client = createMockClient([{ data: [] }]);

    await fetchAllPages(client as any, "/test", {});

    const calls = client.request.mock.calls;
    expect(calls[0][1]).toEqual({ limit: 500, offset: 0 });
  });
});
