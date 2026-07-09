import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse, BatchResponse } from "../types/common.js";
import type {
  TransactionListItem,
  TransactionDetail,
  AssignedReceiptItem,
  AssignedTransactionItem,
} from "../types/api-responses.js";
import { formatList, formatSingle, formatSuccess, formatBatchResult } from "../utils/formatters.js";
import { fetchAllPages, paginationCapNote } from "../utils/pagination.js";
import { dateSchema, dateTimeSchema, currencySchema } from "../utils/validators.js";

export function registerTransactionsTools(server: McpServer, client: BbClient): void {
  server.tool(
    "list_transactions",
    "List bank transactions (Kontoumsätze) with optional filters",
    {
      id_by_customer_from: z.number().int().optional().describe("Filter from this transaction ID"),
      id_by_customer_to: z.number().int().optional().describe("Filter up to this transaction ID"),
      date_from: dateSchema.optional().describe("Start date (YYYY-MM-DD)"),
      date_to: dateSchema.optional().describe("End date (YYYY-MM-DD)"),
      account: z.number().int().optional().describe("Filter by payment account ID"),
      to_from: z.string().optional().describe("Filter by sender/recipient"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (1-500)"),
      offset: z.number().int().min(0).optional().describe("Offset for pagination"),
      auto_paginate: z.boolean().optional().describe("Fetch all pages automatically (default: false)"),
      max_results: z.number().int().min(1).optional().describe("Maximum number of results to return in the response"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {};
        if (params.id_by_customer_from !== undefined) requestParams.id_by_customer_from = params.id_by_customer_from;
        if (params.id_by_customer_to !== undefined) requestParams.id_by_customer_to = params.id_by_customer_to;
        if (params.date_from !== undefined) requestParams.date_from = params.date_from;
        if (params.date_to !== undefined) requestParams.date_to = params.date_to;
        if (params.account !== undefined) requestParams.account = params.account;
        if (params.to_from !== undefined) requestParams.to_from = params.to_from;
        if (params.limit !== undefined) requestParams.limit = params.limit;
        if (params.offset !== undefined) requestParams.offset = params.offset;

        let data: TransactionListItem[];
        let totalRows: number | undefined;
        let paginationNote: string | undefined;

        if (params.auto_paginate) {
          const result = await fetchAllPages<TransactionListItem>(client, "/transactions/get", requestParams, { pageSize: 500 });
          data = result.data;
          totalRows = result.totalRows;
          if (result.hasMore) paginationNote = paginationCapNote(result.pagesLoaded);
        } else {
          const res = await client.request<ApiResponse<TransactionListItem[]>>("/transactions/get", requestParams);
          data = res.data ?? [];
          totalRows = res.rows;
        }

        return {
          content: [{
            type: "text" as const,
            text: formatList("Transactions", data, totalRows,
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
    "get_transaction",
    "Get a single transaction by its ID",
    {
      id_by_customer: z.string().describe("Transaction ID (id_by_customer)"),
    },
    async (params) => {
      try {
        const res = await client.request<ApiResponse<TransactionDetail>>(
          `/transactions/get/${params.id_by_customer}`
        );
        return {
          content: [{
            type: "text" as const,
            text: formatSingle("Transaction", res.data ?? {}),
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

  const transactionFields = {
    account: z.number().int().describe("Payment account ID"),
    to_from: z.string().describe("Sender/recipient"),
    amount: z.number().describe("Transaction amount"),
    booking_date: dateTimeSchema.describe("Booking date (YYYY-MM-DD HH:MM:SS)"),
    value_date: dateTimeSchema.optional().describe("Value date (YYYY-MM-DD HH:MM:SS), defaults to booking_date"),
    account_number: z.string().optional().describe("Counter-party account number"),
    bank_code: z.string().optional().describe("Counter-party bank code"),
    bank_name: z.string().optional().describe("Counter-party bank name"),
    purpose: z.string().optional().describe("Purpose / description"),
    type: z.string().optional().describe("Transaction type"),
    booking_text: z.string().optional().describe("Booking text"),
    payment_reference: z.string().optional().describe("Payment reference"),
    currency: currencySchema.optional().describe("Currency code"),
  };

  server.tool(
    "create_transaction",
    "Create one or multiple transactions. Pass a single transaction's fields directly, or a 'transactions' array (max 50) for batch creation",
    {
      // Single transaction fields
      account: z.number().int().optional().describe("Payment account ID (required for single)"),
      to_from: z.string().optional().describe("Sender/recipient (required for single)"),
      amount: z.number().optional().describe("Transaction amount (required for single)"),
      booking_date: dateTimeSchema.optional().describe("Booking date YYYY-MM-DD HH:MM:SS (required for single)"),
      value_date: dateTimeSchema.optional().describe("Value date (YYYY-MM-DD HH:MM:SS), defaults to booking_date"),
      account_number: z.string().optional().describe("Counter-party account number"),
      bank_code: z.string().optional().describe("Counter-party bank code"),
      bank_name: z.string().optional().describe("Counter-party bank name"),
      purpose: z.string().optional().describe("Purpose / description"),
      type: z.string().optional().describe("Transaction type"),
      booking_text: z.string().optional().describe("Booking text"),
      payment_reference: z.string().optional().describe("Payment reference"),
      currency: currencySchema.optional().describe("Currency code"),
      // Batch
      transactions: z.array(z.object(transactionFields)).max(50).optional().describe("Array of transactions for batch creation (max 50)"),
    },
    async (params) => {
      try {
        if (params.transactions !== undefined && params.transactions.length > 0) {
          // Batch creation
          const res = await client.request<BatchResponse>(
            "/transactions/addBatch",
            { transactions: params.transactions },
            "batch"
          );
          // Per the API's Swagger schema, `transactions` only ever contains successful
          // items (success is fixed `true`); failures live in the separate `errors`
          // array, not mixed into `transactions` -- filtering `transactions` for
          // success===false always yields [] and silently drops real errors.
          const successes = ((res as Record<string, unknown>).transactions ?? []) as Record<string, unknown>[];
          const errors = res.errors ?? [];
          return {
            content: [{
              type: "text" as const,
              text: formatBatchResult("Batch transaction creation", successes, errors),
            }],
          };
        }

        // Single creation - validate required fields
        if (params.account === undefined || !params.to_from || params.amount === undefined || !params.booking_date) {
          return {
            content: [{ type: "text" as const, text: "Error: account, to_from, amount, and booking_date are required for single transaction creation" }],
            isError: true,
          };
        }

        const requestParams: Record<string, unknown> = {
          account: params.account,
          to_from: params.to_from,
          amount: params.amount,
          booking_date: params.booking_date,
        };
        if (params.value_date !== undefined) requestParams.value_date = params.value_date;
        if (params.account_number !== undefined) requestParams.account_number = params.account_number;
        if (params.bank_code !== undefined) requestParams.bank_code = params.bank_code;
        if (params.bank_name !== undefined) requestParams.bank_name = params.bank_name;
        if (params.purpose !== undefined) requestParams.purpose = params.purpose;
        if (params.type !== undefined) requestParams.type = params.type;
        if (params.booking_text !== undefined) requestParams.booking_text = params.booking_text;
        if (params.payment_reference !== undefined) requestParams.payment_reference = params.payment_reference;
        if (params.currency !== undefined) requestParams.currency = params.currency;

        const res = await client.request<ApiResponse>("/transactions/add", requestParams);
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Transaction created", {
              account: params.account,
              to_from: params.to_from,
              amount: params.amount,
              booking_date: params.booking_date,
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

  server.tool(
    "assign_receipt_to_transaction",
    "Assign or unassign receipts to/from transactions, or batch-assign multiple pairs",
    {
      action: z.enum(["assign", "unassign", "assign_batch"]).describe("Action: assign, unassign, or assign_batch"),
      transaction_id_by_customer: z.string().optional().describe("Transaction ID (required for assign/unassign)"),
      receipt_id_by_customer: z.string().optional().describe("Receipt ID (required for assign/unassign)"),
      transactions_to_receipts: z.array(z.object({
        transaction_id_by_customer: z.string().describe("Transaction ID"),
        receipt_id_by_customer: z.string().describe("Receipt ID"),
      })).max(50).optional().describe("Array of transaction-receipt pairs (required for assign_batch, max 50)"),
    },
    async (params) => {
      try {
        if (params.action === "assign_batch") {
          if (!params.transactions_to_receipts || params.transactions_to_receipts.length === 0) {
            return {
              content: [{ type: "text" as const, text: "Error: transactions_to_receipts array is required for assign_batch" }],
              isError: true,
            };
          }
          const res = await client.request<BatchResponse>(
            "/transactions/assign-batch/receipt",
            { transactions_to_receipts: params.transactions_to_receipts },
            "batch"
          );
          // Per the API's Swagger schema, `transactions_to_receipts` only ever
          // contains successful items; failures live in the separate `errors`
          // array. The previous version ignored the response entirely and always
          // reported "Batch assignment completed" for the full requested count,
          // even when some/all pairs actually failed.
          const successes = ((res as Record<string, unknown>).transactions_to_receipts ?? []) as Record<string, unknown>[];
          const errors = res.errors ?? [];
          return {
            content: [{
              type: "text" as const,
              text: formatBatchResult("Batch receipt-to-transaction assignment", successes, errors),
            }],
          };
        }

        // assign or unassign
        if (!params.transaction_id_by_customer || !params.receipt_id_by_customer) {
          return {
            content: [{ type: "text" as const, text: "Error: transaction_id_by_customer and receipt_id_by_customer are required for assign/unassign" }],
            isError: true,
          };
        }

        const path = params.action === "assign"
          ? "/transactions/assign/receipt"
          : "/transactions/unassign/receipt";

        const res = await client.request<ApiResponse>(path, {
          transaction_id_by_customer: params.transaction_id_by_customer,
          receipt_id_by_customer: params.receipt_id_by_customer,
        });
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? `Receipt ${params.action}ed`, {
              transaction_id_by_customer: params.transaction_id_by_customer,
              receipt_id_by_customer: params.receipt_id_by_customer,
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

  server.tool(
    "get_assigned_documents",
    "Get receipts assigned to a transaction, or transactions assigned to a receipt",
    {
      source_type: z.enum(["transaction", "receipt"]).describe("Look up from a transaction or a receipt"),
      transaction_id_by_customer: z.string().optional().describe("Transaction ID (required when source_type is 'transaction')"),
      receipt_id_by_customer: z.string().optional().describe("Receipt ID (required when source_type is 'receipt')"),
      confirmed_only: z.boolean().optional().describe("Only return confirmed assignments"),
    },
    async (params) => {
      try {
        if (params.source_type === "transaction") {
          if (!params.transaction_id_by_customer) {
            return {
              content: [{ type: "text" as const, text: "Error: transaction_id_by_customer is required when source_type is 'transaction'" }],
              isError: true,
            };
          }
          const requestParams: Record<string, unknown> = {
            transaction_id_by_customer: params.transaction_id_by_customer,
          };
          if (params.confirmed_only !== undefined) requestParams.confirmed_only = params.confirmed_only;

          const res = await client.request<ApiResponse<AssignedReceiptItem[]>>(
            "/transactions/assigned-receipts/get",
            requestParams
          );
          return {
            content: [{
              type: "text" as const,
              text: formatList("Assigned Receipts", res.data ?? [], res.rows),
            }],
          };
        }

        // source_type === "receipt"
        if (!params.receipt_id_by_customer) {
          return {
            content: [{ type: "text" as const, text: "Error: receipt_id_by_customer is required when source_type is 'receipt'" }],
            isError: true,
          };
        }
        const requestParams: Record<string, unknown> = {
          receipt_id_by_customer: params.receipt_id_by_customer,
        };
        if (params.confirmed_only !== undefined) requestParams.confirmed_only = params.confirmed_only;

        const res = await client.request<ApiResponse<AssignedTransactionItem[]>>(
          "/receipts/assigned-transactions/get",
          requestParams
        );
        return {
          content: [{
            type: "text" as const,
            text: formatList("Assigned Transactions", res.data ?? [], res.rows),
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
