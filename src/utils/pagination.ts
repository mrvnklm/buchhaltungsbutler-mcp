import type { BbClient } from "../api/client.js";
import type { ApiResponse, RateLimitBucket } from "../types/common.js";

export async function fetchAllPages<T>(
  client: BbClient,
  path: string,
  params: Record<string, unknown>,
  options?: { maxPages?: number; pageSize?: number; bucket?: RateLimitBucket }
): Promise<{ data: T[]; totalRows?: number; pagesLoaded: number; hasMore: boolean }> {
  const maxPages = options?.maxPages ?? 10;
  const pageSize = options?.pageSize ?? 500;
  const bucket = options?.bucket ?? "general";

  const allData: T[] = [];
  let totalRows: number | undefined;
  let pagesLoaded = 0;
  let offset = (params.offset as number) ?? 0;

  for (let page = 0; page < maxPages; page++) {
    const pageParams = { ...params, limit: pageSize, offset };
    const res = await client.request<ApiResponse<T[]>>(path, pageParams, bucket);

    const pageData = res.data ?? [];
    allData.push(...pageData);
    pagesLoaded++;

    if (totalRows === undefined && res.rows !== undefined) {
      totalRows = res.rows;
    }

    // Stop conditions
    if (pageData.length < pageSize) break;
    if (totalRows !== undefined && allData.length >= totalRows) break;

    offset += pageSize;
  }

  return {
    data: allData,
    totalRows,
    pagesLoaded,
    hasMore: totalRows !== undefined ? allData.length < totalRows : false,
  };
}
