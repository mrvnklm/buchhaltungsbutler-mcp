import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse, BatchResponse } from "../types/common.js";
import type { PostingItem } from "../types/api-responses.js";
import { formatList, formatSuccess, formatBatchResult } from "../utils/formatters.js";
import { fetchAllPages, paginationCapNote } from "../utils/pagination.js";
import { dateSchema, vatCodeSchema } from "../utils/validators.js";

/**
 * Extract a scalar field value from an error's `request_data` (shape is not
 * guaranteed by BatchResponse, so this is defensive) for matching an error
 * back to the request item it came from.
 */
function extractRequestDataId(requestData: unknown, key: string): string | undefined {
  if (requestData && typeof requestData === "object" && key in (requestData as Record<string, unknown>)) {
    const value = (requestData as Record<string, unknown>)[key];
    return value === undefined || value === null ? undefined : String(value);
  }
  return undefined;
}

/**
 * BatchResponse gives no guarantee that `errors` corresponds to a trailing
 * suffix of the request array (or any positional ordering at all) -- each
 * error only carries the offending `request_data`. To correctly attribute
 * success/failure per item, match each error back to its originating
 * request item via a unique id field instead of assuming array position.
 */
function splitBatchByRequestData<T>(
  items: T[],
  errors: BatchResponse["errors"],
  idKey: keyof T
): { successes: T[]; failedIds: Set<string> } {
  const errorList = errors ?? [];
  const failedIds = new Set<string>();
  for (const err of errorList) {
    const id = extractRequestDataId(err.request_data, idKey as string);
    if (id !== undefined) failedIds.add(id);
  }
  const successes = items.filter((item) => !failedIds.has(String(item[idKey])));
  return { successes, failedIds };
}

export function registerPostingsTools(server: McpServer, client: BbClient): void {
  server.tool(
    "list_postings",
    "List postings (Buchungen) within a date range. Returns all posting types including receipt postings, transaction postings, and free postings.",
    {
      date_from: dateSchema.describe("Start date (YYYY-MM-DD)"),
      date_to: dateSchema.describe("End date (YYYY-MM-DD)"),
      date_last_action_from: dateSchema.optional().describe("Filter by last action start date (YYYY-MM-DD)"),
      date_last_action_to: dateSchema.optional().describe("Filter by last action end date (YYYY-MM-DD)"),
      account: z.string().optional().describe("Filter by account: 'all', 'all financial accounts', 'free booking', or comma-separated account numbers"),
      postingaccount: z.string().optional().describe("Filter by posting account: 'all', 'all postingaccounts', 'all debtors', 'all creditors', or account numbers"),
      posting_status: z.enum(["all", "fixed", "unfixed"]).optional().describe("Filter by posting status"),
      cost_location: z.string().optional().describe("Filter by cost location code"),
      order: z.string().optional().describe("Sort order: 'default', 'date ASC', 'date DESC', 'date_last_action ASC', 'date_last_action DESC', 'id_by_customer ASC', 'id_by_customer DESC'"),
      limit: z.number().int().min(1).max(1000).optional().describe("Maximum number of results (max 1000)"),
      offset: z.number().int().min(0).optional().describe("Offset for pagination"),
      auto_paginate: z.boolean().optional().describe("Fetch all pages automatically (default: false)"),
      max_results: z.number().int().min(1).optional().describe("Maximum number of results to return in the response"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {
          date_from: params.date_from,
          date_to: params.date_to,
        };
        if (params.date_last_action_from !== undefined) requestParams.date_last_action_from = params.date_last_action_from;
        if (params.date_last_action_to !== undefined) requestParams.date_last_action_to = params.date_last_action_to;
        if (params.account !== undefined) requestParams.account = params.account;
        if (params.postingaccount !== undefined) requestParams.postingaccount = params.postingaccount;
        if (params.posting_status !== undefined) requestParams.posting_status = params.posting_status;
        if (params.cost_location !== undefined) requestParams.cost_location = params.cost_location;
        if (params.order !== undefined) requestParams.order = params.order;
        if (params.limit !== undefined) requestParams.limit = params.limit;
        if (params.offset !== undefined) requestParams.offset = params.offset;

        let data: PostingItem[];
        let totalRows: number | undefined;
        let paginationNote: string | undefined;

        if (params.auto_paginate) {
          const result = await fetchAllPages<PostingItem>(client, "/postings/get", requestParams, { pageSize: 1000 });
          data = result.data;
          totalRows = result.totalRows;
          if (result.hasMore) paginationNote = paginationCapNote(result.pagesLoaded);
        } else {
          const res = await client.request<ApiResponse<PostingItem[]>>("/postings/get", requestParams);
          data = res.data ?? [];
          totalRows = res.rows;
        }

        return {
          content: [{
            type: "text" as const,
            text: formatList("Postings", data, totalRows,
              { maxItems: params.max_results, note: paginationNote }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "create_posting",
    `Create a posting (Buchung). Supports receipt postings, transaction postings, and free postings.

For receipt and transaction types, provide a single item OR an array for batch creation.

posting_type determines which fields are required:
- "receipt": receipt_id_by_customer, postingaccounts, postingtexts, vats, amounts (single) OR receipts array (batch)
- "transaction": transaction_id_by_customer, postingaccounts, postingtexts, vats, amounts (single) OR transactions array (batch)
- "free": date, postingtext, amount, postingaccount_debit, postingaccount_credit, vat (single) OR free_postings array (batch)

VAT codes: 0_none, 19_vat, 7_vat, 19_pre, 7_pre, 19_both_1, 19_both_2, 7_both, 19_both_1_no_pre, 19_both_2_no_pre, 7_both_no_pre, 19_pre_app, 7_pre_app, 19_both_app_1, 19_both_app_2, 7_both_app`,
    {
      posting_type: z.enum(["receipt", "transaction", "free"]).describe("Type of posting to create"),

      // Receipt single fields
      receipt_id_by_customer: z.number().int().optional().describe("Receipt ID (required for receipt type, single)"),
      // Transaction single fields
      transaction_id_by_customer: z.number().int().optional().describe("Transaction ID (required for transaction type, single)"),

      // Shared split fields for receipt/transaction single
      postingaccounts: z.array(z.string()).optional().describe("Posting account numbers for each split (required for receipt/transaction)"),
      postingtexts: z.array(z.string()).optional().describe("Posting texts for each split (required for receipt/transaction)"),
      vats: z.array(vatCodeSchema).optional().describe("VAT codes for each split (required for receipt/transaction)"),
      amounts: z.array(z.string()).optional().describe("Amounts for each split (required for receipt/transaction)"),
      creditor: z.number().int().optional().describe("Creditor posting account number (receipt only)"),
      debtor: z.number().int().optional().describe("Debtor posting account number (receipt only)"),
      cost_locations: z.array(z.string()).optional().describe("Cost location codes for each split"),
      cost_locations_two: z.array(z.string()).optional().describe("Secondary cost location codes for each split"),
      oi_receipts_ids_by_customer: z.array(z.number().int()).optional().describe("Original invoice receipt IDs (transaction only)"),

      // Free posting single fields
      date: dateSchema.optional().describe("Posting date YYYY-MM-DD (required for free type)"),
      postingtext: z.string().max(128).optional().describe("Posting text, max 128 chars (required for free type)"),
      amount: z.string().optional().describe("Amount (required for free type)"),
      postingaccount_debit: z.number().int().optional().describe("Debit posting account number (required for free type)"),
      postingaccount_credit: z.number().int().optional().describe("Credit posting account number (required for free type)"),
      vat: vatCodeSchema.optional().describe("VAT code (required for free type)"),
      cost_location: z.string().optional().describe("Cost location code (free type)"),
      cost_location_two: z.string().optional().describe("Secondary cost location code (free type)"),

      // Batch arrays
      receipts: z.array(z.object({
        receipt_id_by_customer: z.number().int(),
        postingaccounts: z.array(z.string()),
        postingtexts: z.array(z.string()),
        vats: z.array(vatCodeSchema),
        amounts: z.array(z.string()),
        creditor: z.number().int().optional(),
        debtor: z.number().int().optional(),
        cost_locations: z.array(z.string()).optional(),
        cost_locations_two: z.array(z.string()).optional(),
      })).max(50).optional().describe("Array of receipt postings for batch creation (max 50)"),

      transactions: z.array(z.object({
        transaction_id_by_customer: z.number().int(),
        postingaccounts: z.array(z.string()),
        postingtexts: z.array(z.string()),
        vats: z.array(vatCodeSchema),
        amounts: z.array(z.string()),
        cost_locations: z.array(z.string()).optional(),
        cost_locations_two: z.array(z.string()).optional(),
        oi_receipts_ids_by_customer: z.array(z.number().int()).optional(),
      })).max(50).optional().describe("Array of transaction postings for batch creation (max 50)"),

      free_postings: z.array(z.object({
        date: dateSchema,
        postingtext: z.string().max(128),
        amount: z.string(),
        postingaccount_debit: z.number().int(),
        postingaccount_credit: z.number().int(),
        vat: vatCodeSchema,
        cost_location: z.string().optional(),
        cost_location_two: z.string().optional(),
      })).max(50).optional().describe("Array of free postings for batch creation (max 50)"),
    },
    async (params) => {
      try {
        switch (params.posting_type) {
          case "receipt": {
            if (params.receipts && params.receipts.length > 0) {
              const res = await client.request<BatchResponse>(
                "/postings/add-batch/receipts",
                { receipts: params.receipts },
                "batch"
              );
              const { successes } = splitBatchByRequestData(params.receipts, res.errors, "receipt_id_by_customer");
              return {
                content: [{
                  type: "text" as const,
                  text: formatBatchResult(
                    "Receipt postings batch",
                    successes.map((r) => ({ id_by_customer: r.receipt_id_by_customer })),
                    res.errors ?? []
                  ),
                }],
              };
            }

            if (!params.receipt_id_by_customer || !params.postingaccounts || !params.postingtexts || !params.vats || !params.amounts) {
              return {
                content: [{ type: "text" as const, text: "Error: receipt_id_by_customer, postingaccounts, postingtexts, vats, and amounts are required for single receipt posting" }],
                isError: true,
              };
            }

            const requestParams: Record<string, unknown> = {
              receipt_id_by_customer: params.receipt_id_by_customer,
              postingaccounts: params.postingaccounts,
              postingtexts: params.postingtexts,
              vats: params.vats,
              amounts: params.amounts,
            };
            if (params.creditor !== undefined) requestParams.creditor = params.creditor;
            if (params.debtor !== undefined) requestParams.debtor = params.debtor;
            if (params.cost_locations !== undefined) requestParams.cost_locations = params.cost_locations;
            if (params.cost_locations_two !== undefined) requestParams.cost_locations_two = params.cost_locations_two;

            const res = await client.request<ApiResponse>("/postings/add/receipt", requestParams);
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Receipt posting created", {
                  receipt_id_by_customer: params.receipt_id_by_customer,
                }),
              }],
            };
          }

          case "transaction": {
            if (params.transactions && params.transactions.length > 0) {
              const res = await client.request<BatchResponse>(
                "/postings/add-batch/transactions",
                { transactions: params.transactions },
                "batch"
              );
              const { successes } = splitBatchByRequestData(params.transactions, res.errors, "transaction_id_by_customer");
              return {
                content: [{
                  type: "text" as const,
                  text: formatBatchResult(
                    "Transaction postings batch",
                    successes.map((t) => ({ id_by_customer: t.transaction_id_by_customer })),
                    res.errors ?? []
                  ),
                }],
              };
            }

            if (!params.transaction_id_by_customer || !params.postingaccounts || !params.postingtexts || !params.vats || !params.amounts) {
              return {
                content: [{ type: "text" as const, text: "Error: transaction_id_by_customer, postingaccounts, postingtexts, vats, and amounts are required for single transaction posting" }],
                isError: true,
              };
            }

            const requestParams: Record<string, unknown> = {
              transaction_id_by_customer: params.transaction_id_by_customer,
              postingaccounts: params.postingaccounts,
              postingtexts: params.postingtexts,
              vats: params.vats,
              amounts: params.amounts,
            };
            if (params.cost_locations !== undefined) requestParams.cost_locations = params.cost_locations;
            if (params.cost_locations_two !== undefined) requestParams.cost_locations_two = params.cost_locations_two;
            if (params.oi_receipts_ids_by_customer !== undefined) requestParams.oi_receipts_ids_by_customer = params.oi_receipts_ids_by_customer;

            const res = await client.request<ApiResponse>("/postings/add/transaction", requestParams);
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Transaction posting created", {
                  transaction_id_by_customer: params.transaction_id_by_customer,
                }),
              }],
            };
          }

          case "free": {
            if (params.free_postings && params.free_postings.length > 0) {
              const res = await client.request<BatchResponse>(
                "/postings/add-batch/free",
                { free_postings: params.free_postings },
                "batch"
              );
              const { successes } = splitBatchByRequestData(params.free_postings, res.errors, "postingtext");
              return {
                content: [{
                  type: "text" as const,
                  text: formatBatchResult(
                    "Free postings batch",
                    successes.map((f) => ({ id_by_customer: f.postingtext })),
                    res.errors ?? []
                  ),
                }],
              };
            }

            if (!params.date || !params.postingtext || !params.amount || params.postingaccount_debit === undefined || params.postingaccount_credit === undefined || !params.vat) {
              return {
                content: [{ type: "text" as const, text: "Error: date, postingtext, amount, postingaccount_debit, postingaccount_credit, and vat are required for single free posting" }],
                isError: true,
              };
            }

            const requestParams: Record<string, unknown> = {
              date: params.date,
              postingtext: params.postingtext,
              amount: params.amount,
              postingaccount_debit: params.postingaccount_debit,
              postingaccount_credit: params.postingaccount_credit,
              vat: params.vat,
            };
            if (params.cost_location !== undefined) requestParams.cost_location = params.cost_location;
            if (params.cost_location_two !== undefined) requestParams.cost_location_two = params.cost_location_two;

            const res = await client.request<ApiResponse>("/postings/add/free", requestParams);
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Free posting created", {
                  date: params.date,
                  postingtext: params.postingtext,
                  amount: params.amount,
                }),
              }],
            };
          }
        }
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "unconfirm_posting",
    "Unconfirm (reopen) a posting to allow modifications. Specify the posting type and the corresponding ID.",
    {
      posting_type: z.enum(["receipt", "transaction", "free"]).describe("Type of posting to unconfirm"),
      receipt_id_by_customer: z.number().int().optional().describe("Receipt ID (required for receipt type)"),
      transaction_id_by_customer: z.number().int().optional().describe("Transaction ID (required for transaction type)"),
      posting_id_by_customer: z.number().int().optional().describe("Posting ID (required for free type)"),
    },
    async (params) => {
      try {
        switch (params.posting_type) {
          case "receipt": {
            if (params.receipt_id_by_customer === undefined) {
              return {
                content: [{ type: "text" as const, text: "Error: receipt_id_by_customer is required for receipt type" }],
                isError: true,
              };
            }
            const res = await client.request<ApiResponse>("/postings/unconfirm/receipt", {
              receipt_id_by_customer: params.receipt_id_by_customer,
            });
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Receipt posting unconfirmed", {
                  receipt_id_by_customer: params.receipt_id_by_customer,
                }),
              }],
            };
          }

          case "transaction": {
            if (params.transaction_id_by_customer === undefined) {
              return {
                content: [{ type: "text" as const, text: "Error: transaction_id_by_customer is required for transaction type" }],
                isError: true,
              };
            }
            const res = await client.request<ApiResponse>("/postings/unconfirm/transaction", {
              transaction_id_by_customer: params.transaction_id_by_customer,
            });
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Transaction posting unconfirmed", {
                  transaction_id_by_customer: params.transaction_id_by_customer,
                }),
              }],
            };
          }

          case "free": {
            if (params.posting_id_by_customer === undefined) {
              return {
                content: [{ type: "text" as const, text: "Error: posting_id_by_customer is required for free type" }],
                isError: true,
              };
            }
            const res = await client.request<ApiResponse>("/postings/unconfirm/free", {
              posting_id_by_customer: params.posting_id_by_customer,
            });
            return {
              content: [{
                type: "text" as const,
                text: formatSuccess(res.message ?? "Free posting unconfirmed", {
                  posting_id_by_customer: params.posting_id_by_customer,
                }),
              }],
            };
          }
        }
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "assign_receipt_to_posting",
    "Assign a receipt to an existing free posting (Beleg einer freien Buchung zuordnen)",
    {
      receipt_id_by_customer: z.number().int().describe("Receipt ID to assign"),
      posting_id_by_customer: z.number().int().describe("Free posting ID to assign the receipt to"),
    },
    async (params) => {
      try {
        const res = await client.request<ApiResponse>("/postings/assign/receipt-to-free-posting", {
          receipt_id_by_customer: params.receipt_id_by_customer,
          posting_id_by_customer: params.posting_id_by_customer,
        });
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Receipt assigned to posting", {
              receipt_id_by_customer: params.receipt_id_by_customer,
              posting_id_by_customer: params.posting_id_by_customer,
            }),
          }],
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            content: [{ type: "text" as const, text: error.toText() }],
            isError: true,
          };
        }
        throw error;
      }
    }
  );
}
