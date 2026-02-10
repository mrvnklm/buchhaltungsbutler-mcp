import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BbClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import type { ApiResponse, BatchResponse } from "../types/common.js";
import type { ReceiptListItem, ReceiptDetail } from "../types/api-responses.js";
import { formatList, formatSingle, formatSuccess, formatBatchResult } from "../utils/formatters.js";
import { dateSchema, receiptTypeSchema, listDirectionSchema, currencySchema } from "../utils/validators.js";

export function registerReceiptsTools(server: McpServer, client: BbClient): void {
  server.tool(
    "list_receipts",
    "List receipts (Belege) filtered by direction, dates, status, counterparty",
    {
      list_direction: listDirectionSchema.describe("'inbound' (Eingangsbelege) or 'outbound' (Ausgangsbelege)"),
      payment_status: z.enum(["paid", "unpaid"]).optional().describe("Filter by payment status"),
      counterparty: z.string().optional().describe("Filter by counterparty name"),
      date_from: dateSchema.optional().describe("Start date (YYYY-MM-DD)"),
      date_to: dateSchema.optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (1-500)"),
      offset: z.number().int().min(0).optional().describe("Offset for pagination"),
      order: z.record(z.string(), z.enum(["ASC", "DESC"])).optional().describe("Sort order, e.g. { date: 'ASC', amount: 'DESC' }"),
      include_offers: z.boolean().optional().describe("Include offers in results"),
      deleted: z.boolean().optional().describe("Include deleted receipts"),
      invoicenumber: z.string().optional().describe("Filter by invoice number"),
      due_date: dateSchema.optional().describe("Filter by due date (YYYY-MM-DD)"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {
          list_direction: params.list_direction,
        };
        if (params.payment_status !== undefined) requestParams.payment_status = params.payment_status;
        if (params.counterparty !== undefined) requestParams.counterparty = params.counterparty;
        if (params.date_from !== undefined) requestParams.date_from = params.date_from;
        if (params.date_to !== undefined) requestParams.date_to = params.date_to;
        if (params.limit !== undefined) requestParams.limit = params.limit;
        if (params.offset !== undefined) requestParams.offset = params.offset;
        if (params.order !== undefined) requestParams.order = params.order;
        if (params.include_offers !== undefined) requestParams.include_offers = params.include_offers;
        if (params.deleted !== undefined) requestParams.deleted = params.deleted;
        if (params.invoicenumber !== undefined) requestParams.invoicenumber = params.invoicenumber;
        if (params.due_date !== undefined) requestParams.due_date = params.due_date;

        const res = await client.request<ApiResponse<ReceiptListItem[]>>("/receipts/get", requestParams);
        return {
          content: [{
            type: "text" as const,
            text: formatList("Receipts", res.data ?? [], res.rows),
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
    "get_receipt",
    "Get a single receipt by its ID, optionally including the file content",
    {
      id_by_customer: z.string().describe("Receipt ID (id_by_customer)"),
      get_file: z.boolean().optional().describe("Include base64-encoded file content in response"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {};
        if (params.get_file !== undefined) requestParams.get_file = params.get_file;

        const res = await client.request<ApiResponse<ReceiptDetail>>(
          `/receipts/get/${params.id_by_customer}`,
          requestParams
        );
        return {
          content: [{
            type: "text" as const,
            text: formatSingle("Receipt", res.data ?? {}),
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

  const receiptFields = {
    type: receiptTypeSchema.describe("Receipt type"),
    counterparty: z.string().describe("Counterparty name"),
    invoice_number: z.string().describe("Invoice number"),
    date: dateSchema.describe("Receipt date (YYYY-MM-DD)"),
    amount: z.number().describe("Amount"),
    currency: currencySchema.describe("Currency code"),
    vat_rate: z.number().optional().describe("VAT rate percentage"),
    account: z.number().int().optional().describe("Payment account ID"),
    creditor_debtor: z.number().int().optional().describe("Creditor/debtor ID"),
    payment_reference: z.string().optional().describe("Payment reference"),
    date_delivery: dateSchema.optional().describe("Delivery date (YYYY-MM-DD)"),
    date_payment_due: dateSchema.optional().describe("Payment due date (YYYY-MM-DD)"),
    link_to_receipt_id_by_customer: z.number().int().optional().describe("Link to another receipt ID"),
  };

  server.tool(
    "create_receipt",
    "Create one or multiple receipts. Pass a single receipt's fields directly, or a 'receipts' array (max 50) for batch creation",
    {
      // Single receipt fields
      type: receiptTypeSchema.optional().describe("Receipt type (required for single)"),
      counterparty: z.string().optional().describe("Counterparty name (required for single)"),
      invoice_number: z.string().optional().describe("Invoice number (required for single)"),
      date: dateSchema.optional().describe("Receipt date YYYY-MM-DD (required for single)"),
      amount: z.number().optional().describe("Amount (required for single)"),
      currency: currencySchema.optional().describe("Currency code (required for single)"),
      vat_rate: z.number().optional().describe("VAT rate percentage"),
      account: z.number().int().optional().describe("Payment account ID"),
      creditor_debtor: z.number().int().optional().describe("Creditor/debtor ID"),
      payment_reference: z.string().optional().describe("Payment reference"),
      date_delivery: dateSchema.optional().describe("Delivery date (YYYY-MM-DD)"),
      date_payment_due: dateSchema.optional().describe("Payment due date (YYYY-MM-DD)"),
      link_to_receipt_id_by_customer: z.number().int().optional().describe("Link to another receipt ID"),
      // Batch
      receipts: z.array(z.object(receiptFields)).max(50).optional().describe("Array of receipts for batch creation (max 50)"),
    },
    async (params) => {
      try {
        if (params.receipts !== undefined && params.receipts.length > 0) {
          // Batch creation
          const res = await client.request<BatchResponse>(
            "/receipts/addBatch",
            { receipts: params.receipts },
            "batch"
          );
          const receipts = ((res as Record<string, unknown>).receipts ?? []) as Record<string, unknown>[];
          const successes = receipts.filter((r) => r.success === true);
          const errors = receipts.filter((r) => r.success === false);
          return {
            content: [{
              type: "text" as const,
              text: formatBatchResult("Batch receipt creation", successes, errors),
            }],
          };
        }

        // Single creation - validate required fields
        if (!params.type || !params.counterparty || !params.invoice_number || !params.date || params.amount === undefined || !params.currency) {
          return {
            content: [{ type: "text" as const, text: "Error: type, counterparty, invoice_number, date, amount, and currency are required for single receipt creation" }],
            isError: true,
          };
        }

        const requestParams: Record<string, unknown> = {
          type: params.type,
          counterparty: params.counterparty,
          invoice_number: params.invoice_number,
          date: params.date,
          amount: params.amount,
          currency: params.currency,
        };
        if (params.vat_rate !== undefined) requestParams.vat_rate = params.vat_rate;
        if (params.account !== undefined) requestParams.account = params.account;
        if (params.creditor_debtor !== undefined) requestParams.creditor_debtor = params.creditor_debtor;
        if (params.payment_reference !== undefined) requestParams.payment_reference = params.payment_reference;
        if (params.date_delivery !== undefined) requestParams.date_delivery = params.date_delivery;
        if (params.date_payment_due !== undefined) requestParams.date_payment_due = params.date_payment_due;
        if (params.link_to_receipt_id_by_customer !== undefined) requestParams.link_to_receipt_id_by_customer = params.link_to_receipt_id_by_customer;

        const res = await client.request<ApiResponse>("/receipts/add", requestParams);
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Receipt created", {
              counterparty: params.counterparty,
              invoice_number: params.invoice_number,
              amount: params.amount,
              currency: params.currency,
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
    "upload_receipt",
    "Upload a receipt file (base64-encoded) with optional metadata",
    {
      file: z.string().describe("Base64-encoded file content"),
      type: receiptTypeSchema.describe("Receipt type"),
      file_name: z.string().optional().describe("File name (recommended for base64 uploads)"),
      account: z.number().int().optional().describe("Payment account ID"),
      creditor_debtor: z.number().int().optional().describe("Creditor/debtor ID"),
      counterparty: z.string().optional().describe("Counterparty name"),
      invoice_number: z.string().optional().describe("Invoice number"),
      date: dateSchema.optional().describe("Receipt date (YYYY-MM-DD)"),
      amount: z.number().optional().describe("Amount"),
      currency: currencySchema.optional().describe("Currency code"),
      vat_rate: z.number().optional().describe("VAT rate percentage"),
      payment_reference: z.string().optional().describe("Payment reference"),
      date_delivery: dateSchema.optional().describe("Delivery date (YYYY-MM-DD)"),
      date_payment_due: dateSchema.optional().describe("Payment due date (YYYY-MM-DD)"),
      link_to_receipt_id_by_customer: z.number().int().optional().describe("Link to another receipt ID"),
    },
    async (params) => {
      try {
        const requestParams: Record<string, unknown> = {
          file: params.file,
          type: params.type,
        };
        if (params.file_name !== undefined) requestParams.file_name = params.file_name;
        if (params.account !== undefined) requestParams.account = params.account;
        if (params.creditor_debtor !== undefined) requestParams.creditor_debtor = params.creditor_debtor;
        if (params.counterparty !== undefined) requestParams.counterparty = params.counterparty;
        if (params.invoice_number !== undefined) requestParams.invoice_number = params.invoice_number;
        if (params.date !== undefined) requestParams.date = params.date;
        if (params.amount !== undefined) requestParams.amount = params.amount;
        if (params.currency !== undefined) requestParams.currency = params.currency;
        if (params.vat_rate !== undefined) requestParams.vat_rate = params.vat_rate;
        if (params.payment_reference !== undefined) requestParams.payment_reference = params.payment_reference;
        if (params.date_delivery !== undefined) requestParams.date_delivery = params.date_delivery;
        if (params.date_payment_due !== undefined) requestParams.date_payment_due = params.date_payment_due;
        if (params.link_to_receipt_id_by_customer !== undefined) requestParams.link_to_receipt_id_by_customer = params.link_to_receipt_id_by_customer;

        const res = await client.request<ApiResponse>("/receipts/upload", requestParams, "upload");
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? "Receipt uploaded", {
              file_name: params.file_name,
              type: params.type,
              counterparty: params.counterparty,
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
    "manage_receipt",
    "Delete or restore a receipt",
    {
      action: z.enum(["delete", "restore"]).describe("Action to perform"),
      id_by_customer: z.string().describe("Receipt ID (id_by_customer)"),
    },
    async (params) => {
      try {
        const path = params.action === "delete"
          ? `/receipts/delete/${params.id_by_customer}`
          : `/receipts/restore/${params.id_by_customer}`;

        const res = await client.request<ApiResponse>(path);
        return {
          content: [{
            type: "text" as const,
            text: formatSuccess(res.message ?? `Receipt ${params.action}d`, {
              id_by_customer: params.id_by_customer,
              action: params.action,
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
