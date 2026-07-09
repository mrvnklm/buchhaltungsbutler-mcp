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
  // Tracks whether the loop ended because we genuinely ran out of data (a
  // short page, or reaching a known totalRows), as opposed to simply
  // exhausting `maxPages`. Only the latter case means "there may be more
  // data we never checked for".
  let stoppedNaturally = false;

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
    if (pageData.length < pageSize) {
      stoppedNaturally = true;
      break;
    }
    if (totalRows !== undefined && allData.length >= totalRows) {
      stoppedNaturally = true;
      break;
    }

    offset += pageSize;
  }

  const hitPageCap = pagesLoaded === maxPages && !stoppedNaturally;

  return {
    data: allData,
    totalRows,
    pagesLoaded,
    // If the API told us the true total, trust that comparison even if we
    // also hit the cap on the same page. Otherwise, hitting the cap without
    // a natural stop means we genuinely don't know if more data exists.
    hasMore: totalRows !== undefined ? allData.length < totalRows : hitPageCap,
  };
}

/** Human-readable note for tool output when auto_paginate stopped without confirming completeness. */
export function paginationCapNote(pagesLoaded: number): string {
  return `Note: auto_paginate stopped after ${pagesLoaded} page(s) without confirming all results were fetched -- more data may exist. Narrow your filters (e.g. date range) to ensure completeness.`;
}
